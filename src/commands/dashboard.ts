/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import type { ConfigLayer, ZoweConfigProfile } from "../types.js";
import { findConfigLayers, isActiveZoweConfig, isZoweConfigFile, loadConfigFile } from "../utils/config-finder.js";
import { getAllEnvironmentChecks, type EnvironmentCheck } from "../utils/environment-checks.js";

let dashboardPanel: vscode.WebviewPanel | undefined;

// ============== Terminal Management ==============
// Reuse a single terminal for all operations to avoid spawning many processes
let inspectorTerminal: vscode.Terminal | undefined;
let terminalCloseListener: vscode.Disposable | undefined;

/**
 * Get or create the inspector terminal. Reuses existing terminal if available.
 */
function getOrCreateTerminal(): vscode.Terminal {
  // Check if our terminal still exists
  if (inspectorTerminal) {
    // Verify it's still in the list of open terminals
    const stillExists = vscode.window.terminals.includes(inspectorTerminal);
    if (stillExists) {
      return inspectorTerminal;
    }
    // Terminal was closed, clear reference
    inspectorTerminal = undefined;
  }
  
  // Create new terminal
  inspectorTerminal = vscode.window.createTerminal("Zowe Inspector");
  
  // Listen for terminal close to clean up reference
  if (!terminalCloseListener) {
    terminalCloseListener = vscode.window.onDidCloseTerminal((closedTerminal) => {
      if (closedTerminal === inspectorTerminal) {
        inspectorTerminal = undefined;
      }
    });
  }
  
  return inspectorTerminal;
}

/**
 * Dispose of the inspector terminal if it exists.
 * Call this when the extension is deactivated or dashboard is closed.
 */
export function disposeTerminal(): void {
  if (inspectorTerminal) {
    inspectorTerminal.dispose();
    inspectorTerminal = undefined;
  }
  if (terminalCloseListener) {
    terminalCloseListener.dispose();
    terminalCloseListener = undefined;
  }
}

// Connection test results storage
const connectionResults = new Map<string, { 
  status: "testing" | "success" | "failed" | "pending"; 
  message: string; 
  latency?: number;
  timestamp: number 
}>();

// Store the profile to highlight when dashboard opens
let highlightProfileName: string | null = null;

// Current active tab
let activeTab = "dashboard";

// Throttle updates to improve performance
let updatePending = false;
let lastUpdateTime = 0;
const UPDATE_THROTTLE_MS = 500;

// Cache for extensions list (refresh every 30 seconds)
let cachedExtensions: Array<{ id: string; name: string; version: string; isActive: boolean }> | null = null;
let extensionsCacheTime = 0;
const CACHE_TTL_MS = 30000;

// Zowe environment variables definitions
const ZOWE_ENV_VARS = [
  { name: "ZOWE_CLI_HOME", description: "Directory for global Zowe CLI configuration files", category: "core" },
  { name: "ZOWE_CLI_PLUGINS_DIR", description: "Directory for CLI plugins", category: "core" },
  { name: "ZOWE_APP_LOG_LEVEL", description: "Application logging level (DEBUG, INFO, WARN, ERROR)", category: "logging" },
  { name: "ZOWE_IMPERATIVE_LOG_LEVEL", description: "Imperative framework logging level", category: "logging" },
  { name: "ZOWE_USE_DAEMON", description: "Enable/disable daemon mode (yes/no)", category: "daemon" },
  { name: "ZOWE_OPT_HOST", description: "Default host for connections", category: "option" },
  { name: "ZOWE_OPT_PORT", description: "Default port for connections", category: "option" },
  { name: "ZOWE_OPT_USER", description: "Default username", category: "option" },
  { name: "ZOWE_OPT_REJECT_UNAUTHORIZED", description: "Reject unauthorized TLS certificates (true/false)", category: "option" },
  { name: "ZOWE_OPT_ENCODING", description: "Default encoding for data set operations", category: "option" },
] as const;

interface SshKeyInfo {
  name: string;
  path: string;
  type: string;
  hasPublicKey: boolean;
}

export async function showDashboard(): Promise<void> {
  await showDashboardInternal(null);
}

export async function showDashboardForProfile(profileName: string): Promise<void> {
  await showDashboardInternal(profileName);
}

async function showDashboardInternal(profileToHighlight: string | null): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  highlightProfileName = profileToHighlight;

  // Always open all existing config files so diagnostics are available
  await openAllActiveConfigFiles(workspaceFolder);

  if (profileToHighlight) {
    await openAndHighlightProfile(workspaceFolder, profileToHighlight);
  }

  if (dashboardPanel) {
    dashboardPanel.reveal(vscode.ViewColumn.Two);
    updateDashboardContent(dashboardPanel, workspaceFolder);
    return;
  }

  dashboardPanel = vscode.window.createWebviewPanel(
    "zoweInspectorDashboard",
    "Zowe Config Inspector",
    vscode.ViewColumn.Two,
    { 
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  dashboardPanel.onDidDispose(() => {
    dashboardPanel = undefined;
    // Dispose terminal when dashboard closes to free up resources
    disposeTerminal();
  });

  dashboardPanel.webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      case "switchTab":
        activeTab = message.tab;
        if (dashboardPanel) {
          updateDashboardContent(dashboardPanel, workspaceFolder, true); // Force update on tab switch
        }
        break;
        
      case "openFile":
        const doc = await vscode.workspace.openTextDocument(message.file);
        const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        const position = new vscode.Position(message.line, message.character);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        break;
      
      case "testConnection":
        await testProfileConnection(message.profileName, message.profileType, workspaceFolder, message.withAuth || false);
        break;
      
      case "openProfile":
        await openProfileInEditor(message.file, message.profileName);
        break;
      
      case "refresh":
        // Clear cache and force full refresh
        cachedExtensions = null;
        extensionsCacheTime = 0;
        if (dashboardPanel) {
          updateDashboardContent(dashboardPanel, workspaceFolder, true);
        }
        break;
        
      case "openTerminal":
        const openTerm = getOrCreateTerminal();
        openTerm.show();
        if (message.cmd) {
          openTerm.sendText(message.cmd);
        }
        break;
      
      case "runCommand":
        if (message.cmd.startsWith("ext install ")) {
          const extId = message.cmd.replace("ext install ", "");
          vscode.commands.executeCommand("workbench.extensions.installExtension", extId);
        } else {
          // Show command in terminal instead of executing directly
          const cmdTerm = getOrCreateTerminal();
          cmdTerm.show();
          cmdTerm.sendText(message.cmd);
        }
        break;
        
      // Environment tab actions
      case "updateCli":
        await updateZoweCli();
        break;
      case "installCli":
        await installZoweCli();
        break;
      case "addEnvVar":
        await addEnvironmentVariable();
        if (dashboardPanel) {
          updateDashboardContent(dashboardPanel, workspaceFolder);
        }
        break;
      case "editEnvVar":
        await editEnvironmentVariable(message.name, message.currentValue);
        if (dashboardPanel) {
          updateDashboardContent(dashboardPanel, workspaceFolder);
        }
        break;
      case "copyEnvExport":
        await copyEnvExportCommand(message.name, message.value);
        break;
      case "updateExtension":
        await updateExtension(message.extId);
        // Clear cache so extensions are re-fetched on next render
        cachedExtensions = null;
        if (dashboardPanel) {
          updateDashboardContent(dashboardPanel, workspaceFolder, true);
        }
        break;
        
      // Credentials tab actions
      case "generateSshKey":
        await generateSshKey();
        if (dashboardPanel) {
          updateDashboardContent(dashboardPanel, workspaceFolder);
        }
        break;
      case "openSshFolder":
        const sshDir = join(homedir(), ".ssh");
        if (existsSync(sshDir)) {
          vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(sshDir));
        }
        break;
      case "copyPublicKey":
        await copyPublicKeyToClipboard(message.keyPath);
        break;
        
      // Layers tab actions
      case "createConfig":
        await createConfigFile(message.path);
        if (dashboardPanel) {
          updateDashboardContent(dashboardPanel, workspaceFolder, true);
        }
        break;
    }
  });

  updateDashboardContent(dashboardPanel, workspaceFolder);

  const diagnosticsListener = vscode.languages.onDidChangeDiagnostics(() => {
    if (dashboardPanel) {
      updateDashboardContent(dashboardPanel, workspaceFolder);
    }
  });

  dashboardPanel.onDidDispose(() => {
    diagnosticsListener.dispose();
  });
}

// ============== Dashboard Tab Helpers ==============

async function openProfileInEditor(filePath: string, profileName: string): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    
    const text = doc.getText();
    const lines = text.split('\n');
    const profileParts = profileName.split('.');
    const lastPart = profileParts[profileParts.length - 1];
    const searchPattern = new RegExp(`"${lastPart}"\\s*:\\s*\\{`);
    
    let targetLine = 0;
    let inCorrectParent = profileParts.length === 1;
    let parentDepth = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (profileParts.length > 1) {
        for (let p = 0; p < profileParts.length - 1; p++) {
          const parentPattern = new RegExp(`"${profileParts[p]}"\\s*:\\s*\\{`);
          if (parentPattern.test(line)) {
            parentDepth = p + 1;
            if (parentDepth === profileParts.length - 1) {
              inCorrectParent = true;
            }
          }
        }
      }
      
      if (searchPattern.test(line) && inCorrectParent) {
        targetLine = i;
        break;
      }
    }
    
    const position = new vscode.Position(targetLine, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  } catch (error) {
    console.error(`Failed to open profile ${profileName} in ${filePath}:`, error);
    vscode.window.showErrorMessage(`Could not open profile: ${profileName}`);
  }
}

async function openAndHighlightProfile(workspaceFolder: string, profileName: string): Promise<void> {
  const layers = findConfigLayers(workspaceFolder);
  const existingLayers = layers.filter(l => l.exists);

  for (const layer of existingLayers) {
    const config = loadConfigFile(layer.path);
    if (config?.profiles) {
      const profileNames = collectAllProfileNames(config.profiles, "");
      if (profileNames.includes(profileName)) {
        await openProfileInEditor(layer.path, profileName);
        return;
      }
    }
  }

  vscode.window.showWarningMessage(`Profile "${profileName}" not found in any active configuration file.`);
}

function collectAllProfileNames(profiles: Record<string, ZoweConfigProfile>, prefix: string): string[] {
  const names: string[] = [];
  for (const [name, profile] of Object.entries(profiles)) {
    const fullName = prefix ? `${prefix}.${name}` : name;
    names.push(fullName);
    if (profile.profiles) {
      names.push(...collectAllProfileNames(profile.profiles, fullName));
    }
  }
  return names;
}

async function openAllActiveConfigFiles(workspaceFolder: string): Promise<void> {
  const layers = findConfigLayers(workspaceFolder);
  const existingLayers = layers.filter(l => l.exists);

  if (existingLayers.length === 0) {
    return;
  }

  // Open all existing config files (in background) so diagnostics provider can validate them
  const openDocs = new Set(vscode.workspace.textDocuments.map(d => d.uri.fsPath));
  
  for (const layer of existingLayers) {
    if (openDocs.has(layer.path)) {
      continue; // Already open
    }
    try {
      // Just open the document - don't show it in editor (preservesFocus doesn't matter here)
      await vscode.workspace.openTextDocument(layer.path);
    } catch (error) {
      console.error(`Failed to open ${layer.path}:`, error);
    }
  }

  // Small delay to let diagnostics provider process the newly opened files
  await new Promise(resolve => setTimeout(resolve, 300));
}

async function testProfileConnection(profileName: string, profileType: string, workspaceFolder: string, withAuth: boolean): Promise<void> {
  if (!dashboardPanel) return;

  const testingMsg = withAuth ? "Testing connection with auth..." : "Testing connection...";
  connectionResults.set(profileName, { status: "testing", message: testingMsg, timestamp: Date.now() });
  updateDashboardContent(dashboardPanel, workspaceFolder);

  const layers = findConfigLayers(workspaceFolder);
  let profileProps: Record<string, unknown> | null = null;

  for (const layer of layers.filter(l => l.exists)) {
    const config = loadConfigFile(layer.path);
    if (config?.profiles) {
      const profile = findProfile(config.profiles, profileName);
      if (profile?.properties) {
        profileProps = { ...(profileProps || {}), ...profile.properties };
      }
    }
  }

  if (!profileProps || !profileProps.host) {
    connectionResults.set(profileName, { 
      status: "failed", 
      message: "No host configured", 
      timestamp: Date.now() 
    });
    updateDashboardContent(dashboardPanel, workspaceFolder);
    return;
  }

  try {
    if (profileType === "ssh") {
      await testSshConnection(profileName, profileProps, withAuth);
    } else if (profileType === "zosmf" || profileType === "tso") {
      await testZosmfConnection(profileName, profileProps, withAuth);
    } else if (profileType === "zftp") {
      await testFtpConnection(profileName, profileProps, withAuth);
    } else {
      connectionResults.set(profileName, { 
        status: "failed", 
        message: `Connection test not supported for type: ${profileType}`, 
        timestamp: Date.now() 
      });
    }
  } catch (error) {
    connectionResults.set(profileName, { 
      status: "failed", 
      message: `Error: ${error instanceof Error ? error.message : String(error)}`, 
      timestamp: Date.now() 
    });
  }

  if (dashboardPanel) {
    updateDashboardContent(dashboardPanel, workspaceFolder);
  }
}

async function testSshConnection(profileName: string, props: Record<string, unknown>, _withAuth: boolean): Promise<void> {
  const host = String(props.host).replace(/^https?:\/\//, "");
  const port = Number(props.port) || 22;
  const startTime = Date.now();

  // Only do basic connectivity test (no process spawning)
  // Auth tests would require spawning ssh which can leave orphan processes
  try {
    const net = await import("node:net");
    
    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => { socket.destroy(); reject(new Error("Connection timed out (5s)")); }, 5000);

      socket.connect(port, host, () => { clearTimeout(timeout); socket.destroy(); resolve(); });
      socket.on("error", (err) => { clearTimeout(timeout); socket.destroy(); reject(err); });
    });

    const latency = Date.now() - startTime;
    connectionResults.set(profileName, { status: "success", message: `SSH port ${port} reachable`, latency, timestamp: Date.now() });
  } catch (error) {
    connectionResults.set(profileName, { 
      status: "failed", 
      message: `Cannot reach ${host}:${port} - ${error instanceof Error ? error.message : "Unknown error"}`, 
      timestamp: Date.now() 
    });
  }
}

async function testZosmfConnection(profileName: string, props: Record<string, unknown>, _withAuth: boolean): Promise<void> {
  const host = String(props.host).replace(/^https?:\/\//, "");
  const port = Number(props.port) || 443;
  const protocol = String(props.protocol || "https");
  const basePath = String(props.basePath || "/zosmf");
  const rejectUnauthorized = props.rejectUnauthorized !== false;
  const startTime = Date.now();

  // Only do basic HTTP connectivity test (no process spawning)
  const url = `${protocol}://${host}:${port}${basePath}/info`;

  try {
    const https = await import("node:https");
    const http = await import("node:http");
    const client = protocol === "https" ? https : http;

    await new Promise<void>((resolve, reject) => {
      const req = client.request(url, { method: "GET", timeout: 10000, rejectUnauthorized }, (res) => {
        res.resume(); // Consume response to free up memory
        if (res.statusCode && res.statusCode < 500) resolve();
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
      req.end();
    });

    const latency = Date.now() - startTime;
    connectionResults.set(profileName, { status: "success", message: `Reachable at ${host}:${port}`, latency, timestamp: Date.now() });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    connectionResults.set(profileName, { status: "failed", message: `Cannot reach ${host}:${port} - ${errMsg}`, timestamp: Date.now() });
  }
}

async function testFtpConnection(profileName: string, props: Record<string, unknown>, withAuth: boolean): Promise<void> {
  const host = String(props.host).replace(/^https?:\/\//, "");
  const port = Number(props.port) || 21;
  const startTime = Date.now();

  if (withAuth) {
    const user = props.user as string | undefined;
    if (!user) {
      connectionResults.set(profileName, { status: "failed", message: "No user configured for auth test", timestamp: Date.now() });
      return;
    }
    
    connectionResults.set(profileName, { status: "failed", message: "FTP auth test requires zFTP plugin", timestamp: Date.now() });
    return;
  }

  try {
    const net = await import("node:net");
    
    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => { socket.destroy(); reject(new Error("Connection timed out (5s)")); }, 5000);
      socket.connect(port, host, () => { clearTimeout(timeout); socket.destroy(); resolve(); });
      socket.on("error", (err) => { clearTimeout(timeout); reject(err); });
    });

    const latency = Date.now() - startTime;
    connectionResults.set(profileName, { status: "success", message: `FTP port ${port} reachable`, latency, timestamp: Date.now() });
  } catch (error) {
    connectionResults.set(profileName, { 
      status: "failed", 
      message: `Cannot reach ${host}:${port} - ${error instanceof Error ? error.message : "Unknown error"}`, 
      timestamp: Date.now() 
    });
  }
}

function findProfile(profiles: Record<string, ZoweConfigProfile>, name: string): ZoweConfigProfile | null {
  const parts = name.split(".");
  let current: Record<string, ZoweConfigProfile> = profiles;
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!current[part]) return null;
    if (i === parts.length - 1) return current[part];
    if (current[part].profiles) current = current[part].profiles!;
    else return null;
  }
  return null;
}

function getInheritedProperties(profiles: Record<string, ZoweConfigProfile>, profileName: string): Record<string, { value: unknown; from: string }> {
  const inherited: Record<string, { value: unknown; from: string }> = {};
  const parts = profileName.split(".");
  
  let current: Record<string, ZoweConfigProfile> = profiles;
  let currentPath = "";
  
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    currentPath = currentPath ? `${currentPath}.${part}` : part;
    
    if (current[part]?.properties) {
      for (const [key, value] of Object.entries(current[part].properties!)) {
        inherited[key] = { value, from: currentPath };
      }
    }
    
    if (current[part]?.profiles) current = current[part].profiles!;
    else break;
  }
  
  return inherited;
}

// ============== Environment Tab Helpers ==============

async function updateZoweCli(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    "This will run 'npm update -g @zowe/cli' in a terminal. Continue?",
    "Update Zowe CLI", "Cancel"
  );
  if (choice !== "Update Zowe CLI") return;

  const term = getOrCreateTerminal();
  term.show();
  term.sendText("npm update -g @zowe/cli");
  term.sendText("echo 'Update complete. Run: zowe --version'");
}

async function installZoweCli(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    "This will run 'npm install -g @zowe/cli' in a terminal. Continue?",
    "Install Zowe CLI", "Cancel"
  );
  if (choice !== "Install Zowe CLI") return;

  const term = getOrCreateTerminal();
  term.show();
  term.sendText("npm install -g @zowe/cli");
  term.sendText("echo 'Installation complete. Run: zowe --version'");
}

async function addEnvironmentVariable(): Promise<void> {
  const items = ZOWE_ENV_VARS.map(v => ({
    label: v.name,
    description: process.env[v.name] ? `Current: ${process.env[v.name]}` : "(not set)",
    detail: v.description,
    envVar: v,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a Zowe environment variable to set",
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!selected) return;

  const currentValue = process.env[selected.envVar.name] || "";
  const newValue = await vscode.window.showInputBox({
    prompt: `Enter value for ${selected.envVar.name}`,
    placeHolder: selected.envVar.description,
    value: currentValue,
  });

  if (newValue === undefined) return;

  const isWindows = process.platform === "win32";
  const isPermanent = await vscode.window.showQuickPick(
    [
      { label: "Session only", description: "Set for this terminal session", value: "session" },
      { label: "Permanent (User)", description: "Set permanently for your user", value: "permanent" },
    ],
    { placeHolder: "How should this variable be set?" }
  );

  if (!isPermanent) return;

  const term = getOrCreateTerminal();
  term.show();

  if (isWindows) {
    if (isPermanent.value === "permanent") {
      term.sendText(`setx ${selected.envVar.name} "${newValue}"`);
      term.sendText(`echo "Environment variable set permanently. Restart VS Code for changes to take effect."`);
    } else {
      term.sendText(`set ${selected.envVar.name}=${newValue}`);
    }
  } else {
    if (isPermanent.value === "permanent") {
      const shell = process.env.SHELL || "/bin/bash";
      const rcFile = shell.includes("zsh") ? "~/.zshrc" : "~/.bashrc";
      term.sendText(`echo 'export ${selected.envVar.name}="${newValue}"' >> ${rcFile}`);
      term.sendText(`source ${rcFile}`);
    } else {
      term.sendText(`export ${selected.envVar.name}="${newValue}"`);
    }
  }
}

async function copyEnvExportCommand(name: string, value: string): Promise<void> {
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? `setx ${name} "${value}"` : `export ${name}="${value}"`;
  await vscode.env.clipboard.writeText(cmd);
  vscode.window.showInformationMessage(`Copied: ${cmd}`);
}

async function editEnvironmentVariable(name: string, currentValue: string): Promise<void> {
  const envVar = ZOWE_ENV_VARS.find(v => v.name === name);
  
  const newValue = await vscode.window.showInputBox({
    prompt: `Edit value for ${name}`,
    placeHolder: envVar?.description || "Enter new value",
    value: currentValue,
  });

  if (newValue === undefined || newValue === currentValue) return;

  const isWindows = process.platform === "win32";
  const isPermanent = await vscode.window.showQuickPick(
    [
      { label: "Session only", description: "Set for this terminal session", value: "session" },
      { label: "Permanent (User)", description: "Set permanently for your user", value: "permanent" },
    ],
    { placeHolder: "How should this variable be set?" }
  );

  if (!isPermanent) return;

  const term = getOrCreateTerminal();
  term.show();

  if (isWindows) {
    if (isPermanent.value === "permanent") {
      term.sendText(`setx ${name} "${newValue}"`);
      term.sendText(`echo "Environment variable updated permanently. Restart VS Code for changes to take effect."`);
    } else {
      term.sendText(`set ${name}=${newValue}`);
    }
  } else {
    if (isPermanent.value === "permanent") {
      const shell = process.env.SHELL || "/bin/bash";
      const rcFile = shell.includes("zsh") ? "~/.zshrc" : "~/.bashrc";
      term.sendText(`echo 'export ${name}="${newValue}"' >> ${rcFile}`);
      term.sendText(`source ${rcFile}`);
    } else {
      term.sendText(`export ${name}="${newValue}"`);
    }
  }
}

async function updateExtension(extId: string): Promise<void> {
  try {
    vscode.window.showInformationMessage(`Checking for updates for ${extId}...`);
    await vscode.commands.executeCommand("workbench.extensions.installExtension", extId);
    vscode.window.showInformationMessage(`Extension ${extId} updated (or already at latest version).`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to update extension: ${error}`);
  }
}

function getZoweRelatedExtensions(): Array<{ id: string; name: string; version: string; isActive: boolean }> {
  const extensions: Array<{ id: string; name: string; version: string; isActive: boolean }> = [];
  for (const ext of vscode.extensions.all) {
    const id = ext.id.toLowerCase();
    if (id.includes("zowe") || id.includes("ibm") || id.includes("mainframe") || id.includes("endevor") || id.includes("cics")) {
      extensions.push({
        id: ext.id,
        name: ext.packageJSON.displayName || ext.id,
        version: ext.packageJSON.version || "unknown",
        isActive: ext.isActive,
      });
    }
  }
  return extensions.sort((a, b) => a.name.localeCompare(b.name));
}

function getZoweEnvVars(): Array<{ name: string; value: string | undefined; description: string; category: string }> {
  return ZOWE_ENV_VARS.map(v => ({ ...v, value: process.env[v.name] }));
}

// ============== Credentials Tab Helpers ==============

async function generateSshKey(): Promise<void> {
  const keyTypes = [
    { label: "Ed25519 (Recommended)", value: "ed25519", description: "Modern, secure, fast" },
    { label: "RSA 4096", value: "rsa", description: "Wide compatibility" },
    { label: "ECDSA", value: "ecdsa", description: "Elliptic curve" },
  ];

  const selectedType = await vscode.window.showQuickPick(keyTypes, { placeHolder: "Select SSH key type to generate" });
  if (!selectedType) return;

  const keyName = await vscode.window.showInputBox({
    prompt: "Enter a name for the key (or leave empty for default)",
    placeHolder: selectedType.value === "ed25519" ? "id_ed25519" : selectedType.value === "rsa" ? "id_rsa" : "id_ecdsa",
  });

  if (keyName === undefined) return;

  const sshDir = join(homedir(), ".ssh");
  const defaultName = selectedType.value === "ed25519" ? "id_ed25519" : selectedType.value === "rsa" ? "id_rsa" : "id_ecdsa";
  const finalName = keyName.trim() || defaultName;
  const keyPath = join(sshDir, finalName);

  if (existsSync(keyPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `Key "${finalName}" already exists. This will show the command but NOT overwrite automatically.`,
      "Show Command", "Cancel"
    );
    if (overwrite !== "Show Command") return;
  }

  let cmd: string;
  switch (selectedType.value) {
    case "ed25519": cmd = `ssh-keygen -t ed25519 -f "${keyPath}" -C "generated-by-zowe-inspector"`; break;
    case "rsa": cmd = `ssh-keygen -t rsa -b 4096 -f "${keyPath}" -C "generated-by-zowe-inspector"`; break;
    case "ecdsa": cmd = `ssh-keygen -t ecdsa -b 521 -f "${keyPath}" -C "generated-by-zowe-inspector"`; break;
    default: cmd = `ssh-keygen -f "${keyPath}"`;
  }

  const term = getOrCreateTerminal();
  term.show();
  term.sendText(`echo "Run this command to generate your SSH key:"`);
  term.sendText(`echo "${cmd}"`);
  term.sendText(`echo ""`);
  term.sendText(`echo "After generating, copy the public key to your mainframe with:"`);
  term.sendText(`echo "ssh-copy-id -i ${keyPath}.pub user@hostname"`);

  vscode.window.showInformationMessage(`SSH key generation command shown in terminal.`);
}

async function copyPublicKeyToClipboard(keyPath: string): Promise<void> {
  const publicKeyPath = keyPath.endsWith(".pub") ? keyPath : `${keyPath}.pub`;
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(publicKeyPath, "utf-8");
    await vscode.env.clipboard.writeText(content.trim());
    vscode.window.showInformationMessage("Public key copied to clipboard!");
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to read public key: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

function getSshKeyInfo(): SshKeyInfo[] {
  const sshDir = join(homedir(), ".ssh");
  const keys: SshKeyInfo[] = [];

  if (!existsSync(sshDir)) return keys;

  try {
    const files = readdirSync(sshDir);
    const keyFiles = files.filter(f => 
      !f.endsWith(".pub") && !f.includes("known_hosts") && !f.includes("config") && !f.includes("authorized_keys")
    );

    for (const file of keyFiles) {
      const filePath = join(sshDir, file);
      try {
        const stat = statSync(filePath);
        if (stat.isFile()) {
          const hasPublicKey = existsSync(`${filePath}.pub`);
          let keyType = "unknown";
          if (file.includes("ed25519")) keyType = "Ed25519";
          else if (file.includes("ecdsa")) keyType = "ECDSA";
          else if (file.includes("rsa")) keyType = "RSA";
          else if (file.includes("dsa")) keyType = "DSA";

          keys.push({ name: file, path: filePath, type: keyType, hasPublicKey });
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }

  return keys;
}

function getCredentialManagerInfo(): { name: string; status: string; details: string } {
  const platform = process.platform;
  switch (platform) {
    case "win32": return { name: "Windows Credential Manager", status: "available", details: "Zowe CLI uses Windows Credential Manager to securely store passwords and tokens." };
    case "darwin": return { name: "macOS Keychain", status: "available", details: "Zowe CLI uses macOS Keychain to securely store passwords and tokens." };
    case "linux": return { name: "libsecret (GNOME Keyring)", status: "check", details: "Zowe CLI uses libsecret on Linux. Ensure gnome-keyring or similar is installed." };
    default: return { name: "Unknown", status: "unknown", details: "Platform not recognized." };
  }
}

// ============== Layers Tab Helpers ==============

async function createConfigFile(filePath: string): Promise<void> {
  const { dirname } = await import("node:path");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  
  const isUserConfig = filePath.includes(".user.json");
  const template = isUserConfig
    ? {
        $schema: "./zowe.schema.json",
        profiles: {},
        defaults: {}
      }
    : {
        $schema: "./zowe.schema.json",
        profiles: {
          example: {
            type: "zosmf",
            properties: {
              host: "your.mainframe.com",
              port: 443
            },
            secure: ["user", "password"]
          }
        },
        defaults: {
          zosmf: "example"
        }
      };
  
  try {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(template, null, 2), "utf-8");
    
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    vscode.window.showInformationMessage(`Created ${filePath}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create config: ${err}`);
  }
}

// ============== Main Content Update ==============

function updateDashboardContent(panel: vscode.WebviewPanel, workspaceFolder: string, force = false): void {
  // Throttle updates unless forced
  const now = Date.now();
  if (!force && now - lastUpdateTime < UPDATE_THROTTLE_MS) {
    if (!updatePending) {
      updatePending = true;
      setTimeout(() => {
        updatePending = false;
        if (dashboardPanel) {
          updateDashboardContent(dashboardPanel, workspaceFolder, true);
        }
      }, UPDATE_THROTTLE_MS);
    }
    return;
  }
  lastUpdateTime = now;

  const layers = findConfigLayers(workspaceFolder);
  const existingLayers = layers.filter(l => l.exists);
  
  // Always collect diagnostics and profiles (needed for status bar)
  const allDiagnostics: Array<{file: string; diagnostics: vscode.Diagnostic[]}> = [];
  const allProfiles: Array<{
    name: string; type: string; source: string;
    properties: Record<string, unknown>;
    inherited: Record<string, { value: unknown; from: string }>;
  }> = [];
  
  // Collect diagnostics from all existing config layers (not just open documents)
  for (const layer of existingLayers) {
    const uri = vscode.Uri.file(layer.path);
    const diagnostics = vscode.languages.getDiagnostics(uri).filter(d => d.source === "Zowe Config Inspector");
    if (diagnostics.length > 0) {
      allDiagnostics.push({ file: layer.path, diagnostics });
    }
  }

  for (const layer of existingLayers) {
    const config = loadConfigFile(layer.path);
    if (config?.profiles) {
      collectProfiles(config.profiles, "", layer.path, config.profiles, allProfiles);
    }
  }

  const totalErrors = allDiagnostics.reduce((sum, d) => sum + d.diagnostics.filter(x => x.severity === vscode.DiagnosticSeverity.Error).length, 0);
  const totalWarnings = allDiagnostics.reduce((sum, d) => sum + d.diagnostics.filter(x => x.severity === vscode.DiagnosticSeverity.Warning).length, 0);

  // Lazy load expensive data only when needed for active tab
  let envChecks: EnvironmentCheck[] = [];
  let extensions: Array<{ id: string; name: string; version: string; isActive: boolean }> = [];
  let zoweEnvVars: Array<{ name: string; value: string | undefined; description: string; category: string }> = [];
  let sshKeys: SshKeyInfo[] = [];
  let credentialManager = { name: "", status: "", details: "" };

  // Only load data needed for the current tab
  if (activeTab === "environment" || activeTab === "dashboard") {
    envChecks = getAllEnvironmentChecks();
  }
  
  if (activeTab === "environment") {
    // Use cached extensions list if available
    if (cachedExtensions && now - extensionsCacheTime < CACHE_TTL_MS) {
      extensions = cachedExtensions;
    } else {
      extensions = getZoweRelatedExtensions();
      cachedExtensions = extensions;
      extensionsCacheTime = now;
    }
    zoweEnvVars = getZoweEnvVars();
  }
  
  if (activeTab === "credentials") {
    sshKeys = getSshKeyInfo();
    credentialManager = getCredentialManagerInfo();
  }

  panel.webview.html = generateTabbedDashboardHtml({
    activeTab,
    layers: existingLayers,
    diagnostics: allDiagnostics,
    profiles: allProfiles,
    totalErrors,
    totalWarnings,
    envChecks,
    connectionResults,
    highlightProfileName,
    extensions,
    zoweEnvVars,
    sshKeys,
    credentialManager,
    allLayers: layers,
  });
  
  highlightProfileName = null;
}

function collectProfiles(
  profiles: Record<string, ZoweConfigProfile>, 
  prefix: string, 
  source: string,
  rootProfiles: Record<string, ZoweConfigProfile>,
  result: Array<{ name: string; type: string; source: string; properties: Record<string, unknown>; inherited: Record<string, { value: unknown; from: string }>; }>
): void {
  for (const [name, profile] of Object.entries(profiles)) {
    const fullName = prefix ? `${prefix}.${name}` : name;
    if (profile.type) {
      if (!result.some(p => p.name === fullName)) {
        result.push({ 
          name: fullName, type: profile.type, source,
          properties: profile.properties || {},
          inherited: getInheritedProperties(rootProfiles, fullName),
        });
      }
    }
    if (profile.profiles) {
      collectProfiles(profile.profiles, fullName, source, rootProfiles, result);
    }
  }
}

// ============== HTML Generation ==============

interface DashboardData {
  activeTab: string;
  layers: ConfigLayer[];
  diagnostics: Array<{file: string; diagnostics: vscode.Diagnostic[]}>;
  profiles: Array<{ name: string; type: string; source: string; properties: Record<string, unknown>; inherited: Record<string, { value: unknown; from: string }>; }>;
  totalErrors: number;
  totalWarnings: number;
  envChecks: EnvironmentCheck[];
  connectionResults: Map<string, { status: string; message: string; latency?: number; timestamp: number }>;
  highlightProfileName: string | null;
  extensions: Array<{ id: string; name: string; version: string; isActive: boolean }>;
  zoweEnvVars: Array<{ name: string; value: string | undefined; description: string; category: string }>;
  sshKeys: SshKeyInfo[];
  credentialManager: { name: string; status: string; details: string };
  allLayers: ConfigLayer[];
}

function generateTabbedDashboardHtml(data: DashboardData): string {
  const { activeTab, totalErrors, totalWarnings } = data;
  
  const statusClass = totalErrors > 0 ? "error" : totalWarnings > 0 ? "warning" : "success";
  const statusIcon = totalErrors > 0 ? "❌" : totalWarnings > 0 ? "⚠️" : "✅";
  const statusText = totalErrors > 0 
    ? `${totalErrors} Error(s), ${totalWarnings} Warning(s)`
    : totalWarnings > 0 ? `${totalWarnings} Warning(s)` : "Configuration Valid";

  let tabContent = "";
  switch (activeTab) {
    case "environment": tabContent = generateEnvironmentTab(data); break;
    case "credentials": tabContent = generateCredentialsTab(data); break;
    case "layers": tabContent = generateLayersTab(data); break;
    default: tabContent = generateDashboardTab(data); break;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zowe Config Inspector</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      padding: 0; margin: 0;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      font-size: 13px;
    }
    
    .tabs {
      display: flex;
      background: var(--vscode-editorGroupHeader-tabsBackground);
      border-bottom: 1px solid var(--vscode-panel-border);
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .tab {
      padding: 10px 16px;
      cursor: pointer;
      border: none;
      background: none;
      color: var(--vscode-foreground);
      font-size: 12px;
      opacity: 0.7;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    .tab:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
    .tab.active { opacity: 1; border-bottom-color: var(--vscode-focusBorder); font-weight: 600; }
    
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 2px solid transparent;
    }
    .header.success { border-bottom-color: #4caf50; }
    .header.warning { border-bottom-color: #ff9800; }
    .header.error { border-bottom-color: #f44336; }
    .header .icon { font-size: 20px; }
    .header .text { font-size: 14px; font-weight: 600; }
    
    .container { padding: 16px; }
    
    .section { margin-bottom: 20px; }
    .section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 6px;
      padding: 12px;
      margin: 6px 0;
    }
    
    .issue {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 10px;
      margin: 4px 0;
      border-radius: 4px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      cursor: pointer;
    }
    .issue:hover { background: var(--vscode-list-hoverBackground); }
    .issue.error { border-left: 3px solid var(--vscode-errorForeground); }
    .issue.warning { border-left: 3px solid var(--vscode-editorWarning-foreground); }
    .issue .location { 
      font-size: 10px;
      background: var(--vscode-badge-background);
      padding: 2px 6px;
      border-radius: 3px;
    }
    
    .profile {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 6px;
      margin: 6px 0;
      overflow: hidden;
    }
    .profile.highlighted {
      box-shadow: 0 0 0 2px var(--vscode-focusBorder);
      animation: highlight-pulse 2s ease-out;
    }
    @keyframes highlight-pulse {
      0% { box-shadow: 0 0 0 2px var(--vscode-focusBorder), 0 0 20px rgba(0, 127, 212, 0.6); }
      100% { box-shadow: 0 0 0 2px var(--vscode-focusBorder); }
    }
    .profile-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
    }
    .profile-icon { font-size: 16px; }
    .profile-link { display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; }
    .profile-link:hover .profile-name { text-decoration: underline; color: var(--vscode-textLink-foreground); }
    .profile-name { font-weight: 600; }
    .profile-type {
      font-size: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 8px;
      border-radius: 10px;
    }
    
    .test-btn-group { display: inline-flex; border-radius: 3px; overflow: hidden; }
    .test-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 3px 8px;
      cursor: pointer;
      font-size: 11px;
    }
    .test-btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    .test-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .test-btn-auth {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-left: 1px solid var(--vscode-button-background);
      padding: 3px 6px;
      cursor: pointer;
      font-size: 9px;
    }
    
    .conn-result {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      font-size: 11px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .conn-result.success { background: rgba(76, 175, 80, 0.1); }
    .conn-result.failed { background: rgba(244, 67, 54, 0.1); }
    .conn-result.testing { background: rgba(33, 150, 243, 0.1); }
    .conn-latency { font-size: 10px; background: var(--vscode-badge-background); padding: 1px 6px; border-radius: 3px; }
    
    .profile.conn-success { border-left: 3px solid #4caf50; }
    .profile.conn-failed { border-left: 3px solid #f44336; }
    .profile.conn-testing { border-left: 3px solid #2196f3; }
    
    .inherited-section { border-top: 1px solid var(--vscode-panel-border); font-size: 11px; }
    .inherited-section summary { padding: 6px 12px; cursor: pointer; color: var(--vscode-descriptionForeground); }
    .inherited-props { padding: 4px 12px 8px 12px; }
    .inherited-prop { display: flex; gap: 8px; padding: 2px 0; }
    .prop-name { color: var(--vscode-symbolIcon-propertyForeground); min-width: 80px; }
    .prop-value { flex: 1; color: var(--vscode-debugTokenExpression-string); }
    .prop-from { color: var(--vscode-descriptionForeground); font-size: 10px; }
    
    .env-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      margin: 2px 0;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 4px;
    }
    .env-icon { flex-shrink: 0; }
    .env-name { min-width: 130px; font-weight: 500; font-size: 11px; }
    .env-value { flex: 1; font-family: var(--vscode-editor-font-family); font-size: 11px; }
    .env-details { font-size: 10px; color: var(--vscode-descriptionForeground); max-width: 180px; }
    
    .action-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      margin: 4px 4px 4px 0;
    }
    .action-btn:hover { background: var(--vscode-button-hoverBackground); }
    .action-btn.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .inline-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 2px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
    }
    .copy-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 2px 6px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
    }
    
    .key-item {
      background: var(--vscode-editor-background);
      border-radius: 4px;
      padding: 10px;
      margin: 6px 0;
    }
    .key-header { display: flex; align-items: center; gap: 8px; }
    .key-icon { font-size: 16px; }
    .key-name { font-weight: 600; flex: 1; }
    .key-type { font-size: 10px; background: var(--vscode-badge-background); padding: 2px 6px; border-radius: 3px; }
    .key-details { margin-top: 6px; font-size: 11px; display: flex; gap: 12px; }
    .key-path { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); }
    .key-meta { color: var(--vscode-descriptionForeground); }
    
    .layer {
      margin: 8px 0;
      padding: 10px 12px;
      border-radius: 5px;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .layer.clickable:hover {
      background: var(--vscode-list-hoverBackground);
      outline: 1px solid var(--vscode-focusBorder);
    }
    .layer.missing { opacity: 0.5; }
    .layer-header { display: flex; align-items: center; gap: 10px; }
    .layer-priority { font-weight: bold; min-width: 25px; }
    .layer-type { font-weight: bold; text-transform: capitalize; }
    .layer-status { margin-left: auto; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .layer-path { margin-top: 4px; font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--vscode-descriptionForeground); }
    .layer-profiles { margin-top: 4px; font-size: 11px; color: var(--vscode-descriptionForeground); }
    
    .no-items { padding: 16px; text-align: center; color: var(--vscode-descriptionForeground); }
    
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .conn-result.testing .conn-icon { animation: pulse 1s infinite; }
  </style>
</head>
<body>
  <div class="tabs">
    <button class="tab ${activeTab === 'dashboard' ? 'active' : ''}" onclick="switchTab('dashboard')">Dashboard</button>
    <button class="tab ${activeTab === 'environment' ? 'active' : ''}" onclick="switchTab('environment')">Environment</button>
    <button class="tab ${activeTab === 'credentials' ? 'active' : ''}" onclick="switchTab('credentials')">Credentials</button>
    <button class="tab ${activeTab === 'layers' ? 'active' : ''}" onclick="switchTab('layers')">Layers</button>
  </div>
  
  <div class="header ${statusClass}">
    <span class="icon">${statusIcon}</span>
    <span class="text">${statusText}</span>
    <button class="action-btn secondary" style="margin-left: auto;" onclick="refresh()">Refresh</button>
  </div>
  
  <div class="container">
    ${tabContent}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    
    function switchTab(tab) { vscode.postMessage({ command: 'switchTab', tab }); }
    function openFile(file, line, character) { vscode.postMessage({ command: 'openFile', file, line, character }); }
    function testConnection(profileName, profileType, withAuth) { vscode.postMessage({ command: 'testConnection', profileName, profileType, withAuth }); }
    function openProfile(file, profileName) { vscode.postMessage({ command: 'openProfile', file, profileName }); }
    function refresh() { vscode.postMessage({ command: 'refresh' }); }
    function runCommand(cmd) { vscode.postMessage({ command: 'runCommand', cmd }); }
    function updateCli() { vscode.postMessage({ command: 'updateCli' }); }
    function installCli() { vscode.postMessage({ command: 'installCli' }); }
    function addEnvVar() { vscode.postMessage({ command: 'addEnvVar' }); }
    function editEnvVar(name, currentValue) { vscode.postMessage({ command: 'editEnvVar', name, currentValue }); }
    function copyEnvExport(name, value) { vscode.postMessage({ command: 'copyEnvExport', name, value }); }
    function updateExtension(extId) { vscode.postMessage({ command: 'updateExtension', extId }); }
    function generateSshKey() { vscode.postMessage({ command: 'generateSshKey' }); }
    function openSshFolder() { vscode.postMessage({ command: 'openSshFolder' }); }
    function copyPublicKey(keyPath) { vscode.postMessage({ command: 'copyPublicKey', keyPath }); }
    function createConfig(path) { vscode.postMessage({ command: 'createConfig', path }); }
    
    window.addEventListener('load', function() {
      const highlighted = document.getElementById('highlighted-profile');
      if (highlighted) highlighted.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  </script>
</body>
</html>`;
}

function generateDashboardTab(data: DashboardData): string {
  const { diagnostics, profiles, connectionResults: connResults, highlightProfileName: highlightProfile } = data;

  const issuesHtml = diagnostics.length > 0 
    ? diagnostics.map(({file, diagnostics: diags}) => `
        <div class="file-name" style="font-size: 11px; color: var(--vscode-textLink-foreground); margin: 8px 0 4px 0;">${escapeHtml(shortenPath(file))}</div>
        ${diags.map(d => `
          <div class="issue ${d.severity === 0 ? 'error' : 'warning'}"
               onclick="openFile('${escapeHtml(file.replace(/\\/g, "\\\\"))}', ${d.range.start.line}, ${d.range.start.character})">
            <span class="icon">${d.severity === 0 ? '❌' : '⚠️'}</span>
            <span style="flex: 1;">${escapeHtml(d.message.split('\n')[0])}</span>
            <span class="location">Ln ${d.range.start.line + 1}</span>
          </div>
        `).join('')}
      `).join('')
    : '<div class="no-items">✅ No issues found</div>';

  const profilesHtml = profiles.length > 0
    ? profiles.map(p => {
        const connResult = connResults.get(p.name);
        const connStatusClass = connResult?.status === "success" ? "conn-success" 
          : connResult?.status === "failed" ? "conn-failed" 
          : connResult?.status === "testing" ? "conn-testing" : "";
        
        const canTest = ["ssh", "zosmf", "tso", "zftp"].includes(p.type);
        const hasInherited = Object.keys(p.inherited).length > 0;
        const escapedSource = escapeHtml(p.source.replace(/\\/g, "\\\\"));
        const isHighlighted = highlightProfile && p.name === highlightProfile;
        const escapedName = escapeHtml(p.name);
        
        return `
          <div class="profile ${connStatusClass}${isHighlighted ? ' highlighted' : ''}" ${isHighlighted ? 'id="highlighted-profile"' : ''}>
            <div class="profile-header">
              <span class="profile-link" onclick="openProfile('${escapedSource}', '${escapedName}')">
                <span class="profile-icon">${getProfileIcon(p.type)}</span>
                <span class="profile-name">${escapedName}</span>
              </span>
              <span class="profile-type">${escapeHtml(p.type)}</span>
              ${canTest ? `
                <button class="test-btn" onclick="testConnection('${escapedName}', '${escapeHtml(p.type)}', false)" ${connResult?.status === "testing" ? "disabled" : ""}>
                  ${connResult?.status === "testing" ? "⏳" : "Test"}
                </button>
              ` : ''}
            </div>
            ${connResult ? `
              <div class="conn-result ${connResult.status}">
                <span class="conn-icon">${connResult.status === "success" ? "✅" : connResult.status === "failed" ? "❌" : "⏳"}</span>
                <span style="flex: 1;">${escapeHtml(connResult.message)}</span>
                ${connResult.latency ? `<span class="conn-latency">${connResult.latency}ms</span>` : ''}
              </div>
            ` : ''}
            ${hasInherited ? `
              <details class="inherited-section">
                <summary>Inherited (${Object.keys(p.inherited).length})</summary>
                <div class="inherited-props">
                  ${Object.entries(p.inherited).map(([key, val]) => `
                    <div class="inherited-prop">
                      <span class="prop-name">${escapeHtml(key)}</span>
                      <span class="prop-value">${escapeHtml(formatValue(val.value))}</span>
                      <span class="prop-from">← ${escapeHtml(val.from)}</span>
                    </div>
                  `).join('')}
                </div>
              </details>
            ` : ''}
          </div>
        `;
      }).join('')
    : '<div class="no-items">No profiles defined</div>';

  return `
    <div class="section">
      <div class="section-title">Issues</div>
      ${issuesHtml}
    </div>
    <div class="section">
      <div class="section-title">Profiles (${profiles.length})</div>
      ${profilesHtml}
    </div>
  `;
}

function generateEnvironmentTab(data: DashboardData): string {
  const { envChecks, extensions, zoweEnvVars } = data;
  const hasZoweCli = envChecks.some(c => c.name === "Zowe CLI" && c.status === "pass");

  const envHtml = envChecks.map(c => `
    <div class="env-item">
      <span class="env-icon">${c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : c.status === 'warn' ? '⚠️' : '❓'}</span>
      <span class="env-name">${escapeHtml(c.name)}</span>
      <span class="env-value">${escapeHtml(c.value)}</span>
      ${c.details ? `<span class="env-details">${escapeHtml(c.details)}</span>` : ''}
      ${c.action ? `<button class="inline-btn" onclick="runCommand('${escapeHtml(c.action.command)}')">${escapeHtml(c.action.label)}</button>` : ''}
    </div>
  `).join('');

  const setVars = zoweEnvVars.filter(v => v.value !== undefined);
  const envVarsHtml = setVars.length > 0
    ? setVars.map(v => `
        <div class="env-item">
          <span class="env-name" style="font-family: var(--vscode-editor-font-family);">${escapeHtml(v.name)}</span>
          <span class="env-value">${escapeHtml(v.value || "")}</span>
          <button class="copy-btn" onclick="editEnvVar('${escapeHtml(v.name)}', '${escapeHtml(v.value || "")}')">Edit</button>
          <button class="copy-btn" onclick="copyEnvExport('${escapeHtml(v.name)}', '${escapeHtml(v.value || "")}')">Copy</button>
        </div>
      `).join('')
    : '<div class="no-items">No Zowe environment variables set</div>';

  const extensionsHtml = extensions.length > 0
    ? extensions.map(ext => `
        <div class="env-item">
          <span class="env-icon">${ext.isActive ? '🟢' : '⚪'}</span>
          <span class="env-name">${escapeHtml(ext.name)}</span>
          <span class="env-value">v${escapeHtml(ext.version)}</span>
          <button class="copy-btn" onclick="updateExtension('${escapeHtml(ext.id)}')">Update</button>
        </div>
      `).join('')
    : '<div class="no-items">No Zowe-related extensions found</div>';

  return `
    <div class="section">
      <div class="section-title">System</div>
      ${envHtml}
    </div>
    <div class="section">
      <div class="section-title">
        Zowe Environment Variables
        <button class="inline-btn" onclick="addEnvVar()">+ Add</button>
      </div>
      ${envVarsHtml}
    </div>
    <div class="section">
      <div class="section-title">VS Code Extensions</div>
      ${extensionsHtml}
    </div>
    <div style="margin-top: 16px;">
      ${hasZoweCli 
        ? '<button class="action-btn" onclick="updateCli()">Update Zowe CLI</button>'
        : '<button class="action-btn" onclick="installCli()">Install Zowe CLI</button>'
      }
      <button class="action-btn" onclick="generateSshKey()">Generate SSH Key</button>
    </div>
  `;
}

function generateCredentialsTab(data: DashboardData): string {
  const { sshKeys, credentialManager } = data;

  const keysHtml = sshKeys.length > 0
    ? sshKeys.map(key => `
        <div class="key-item">
          <div class="key-header">
            <span class="key-icon">🔑</span>
            <span class="key-name">${escapeHtml(key.name)}</span>
            <span class="key-type">${escapeHtml(key.type)}</span>
            ${key.hasPublicKey ? `<button class="copy-btn" onclick="copyPublicKey('${escapeHtml(key.path.replace(/\\/g, "\\\\"))}')">Copy Public Key</button>` : ''}
          </div>
          <div class="key-details">
            <span class="key-path">${escapeHtml(key.path)}</span>
            <span class="key-meta">${key.hasPublicKey ? '✅ Has public key' : '⚠️ No public key'}</span>
          </div>
        </div>
      `).join('')
    : '<div class="no-items">No SSH keys found in ~/.ssh</div>';

  return `
    <div class="section">
      <div class="section-title">Credential Manager</div>
      <div class="card">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <span style="font-weight: 600;">${escapeHtml(credentialManager.name)}</span>
          <span style="font-size: 10px; background: var(--vscode-badge-background); padding: 2px 8px; border-radius: 10px;">${escapeHtml(credentialManager.status)}</span>
        </div>
        <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">${escapeHtml(credentialManager.details)}</div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">SSH Keys</div>
      ${keysHtml}
    </div>
    <div style="margin-top: 16px;">
      <button class="action-btn" onclick="generateSshKey()">Generate New SSH Key</button>
      <button class="action-btn secondary" onclick="openSshFolder()">Open ~/.ssh Folder</button>
    </div>
  `;
}

function generateLayersTab(data: DashboardData): string {
  const { allLayers } = data;

  const layersHtml = allLayers.slice().reverse().map((layer, index) => {
    const priority = allLayers.length - index;
    const statusIcon = layer.exists ? "✅" : "⬜";
    const typeLabel = layer.userConfig ? `${layer.type} User` : layer.type;
    const escapedPath = escapeHtml(layer.path.replace(/\\/g, "\\\\"));
    const clickable = layer.exists ? `onclick="openFile('${escapedPath}', 0, 0)" style="cursor: pointer;"` : "";

    return `
      <div class="layer ${layer.exists ? "clickable" : "missing"}" ${clickable}>
        <div class="layer-header">
          <span class="layer-priority">${priority}.</span>
          <span>${statusIcon}</span>
          <span class="layer-type">${escapeHtml(typeLabel)}</span>
          <span class="layer-status">${layer.exists ? "exists" : "not found"}</span>
          ${!layer.exists ? `<button class="inline-btn" onclick="event.stopPropagation(); createConfig('${escapedPath}')">Create</button>` : ""}
        </div>
        <div class="layer-path">${escapeHtml(layer.path)}</div>
        ${layer.exists && layer.profiles.length > 0 ? `<div class="layer-profiles">Profiles: ${escapeHtml(layer.profiles.join(", "))}</div>` : ""}
      </div>
    `;
  }).join('');

  return `
    <div class="section">
      <div class="section-title">Configuration Layers</div>
      <p style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 12px;">
        Higher layers override lower layers. Project configs take precedence over global configs. Click to open.
      </p>
      ${layersHtml}
    </div>
  `;
}

function getProfileIcon(type: string): string {
  switch (type) {
    case "ssh": return "🔑";
    case "zosmf": return "🌐";
    case "base": return "📦";
    case "tso": return "🟩";
    case "zftp": return "📂";
    case "cics": return "🟩";
    case "endevor": return "📚";
    case "db2": return "🗄️";
    default: return "▪️";
  }
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    if (value.length > 30) return `"${value.substring(0, 27)}..."`;
    return `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return JSON.stringify(value);
}

function shortenPath(path: string): string {
  const parts = path.split(/[/\\]/);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-2).join("/")}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
