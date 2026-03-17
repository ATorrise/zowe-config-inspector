/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import * as vscode from "vscode";
import type { ZoweConfigProfile } from "../types.js";
import { findConfigLayers, isActiveZoweConfig, isZoweConfigFile, loadConfigFile } from "../utils/config-finder.js";
import { getAllEnvironmentChecks, type EnvironmentCheck } from "../utils/environment-checks.js";

let dashboardPanel: vscode.WebviewPanel | undefined;

// Connection test results storage
const connectionResults = new Map<string, { 
  status: "testing" | "success" | "failed" | "pending"; 
  message: string; 
  latency?: number;
  timestamp: number 
}>();

// Store the profile to highlight when dashboard opens
let highlightProfileName: string | null = null;

export async function showDashboard(): Promise<void> {
  await showDashboardInternal(null);
}

/**
 * Show the dashboard and highlight a specific profile (from Zowe Explorer context menu).
 */
export async function showDashboardForProfile(profileName: string): Promise<void> {
  await showDashboardInternal(profileName);
}

async function showDashboardInternal(profileToHighlight: string | null): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  highlightProfileName = profileToHighlight;

  // Check if any ACTIVE Zowe config file is currently open (not copies/backups)
  const hasOpenConfig = vscode.workspace.textDocuments.some(doc => isActiveZoweConfig(doc.uri.fsPath));
  
  // If no active config is open, open all found active config files so they get validated
  if (!hasOpenConfig) {
    await openAllActiveConfigFiles(workspaceFolder);
  }

  // If a specific profile was requested, also open the config file containing it and jump to it
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
  });

  dashboardPanel.webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
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
        if (dashboardPanel) {
          updateDashboardContent(dashboardPanel, workspaceFolder);
        }
        break;
        
      case "openTerminal":
        const terminal = vscode.window.createTerminal("Zowe Inspector");
        terminal.show();
        if (message.cmd) {
          terminal.sendText(message.cmd);
        }
        break;
      
      case "runCommand":
        // Handle different command types
        if (message.cmd.startsWith("ext install ")) {
          // VS Code extension install
          const extId = message.cmd.replace("ext install ", "");
          vscode.commands.executeCommand("workbench.extensions.installExtension", extId);
        } else if (message.cmd.includes("CredentialManager") || message.cmd.includes("Keychain")) {
          // Open system credential manager
          const { exec } = await import("node:child_process");
          exec(message.cmd);
        } else {
          // Run in terminal
          const cmdTerminal = vscode.window.createTerminal("Zowe Inspector");
          cmdTerminal.show();
          cmdTerminal.sendText(message.cmd);
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

/**
 * Opens a config file and jumps to the specified profile's location.
 */
async function openProfileInEditor(filePath: string, profileName: string): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    
    // Find the profile in the document
    const text = doc.getText();
    const lines = text.split('\n');
    
    // Build the search pattern for nested profiles
    // e.g., "b037.ssh" should find "ssh" inside "b037"
    const profileParts = profileName.split('.');
    const lastPart = profileParts[profileParts.length - 1];
    
    // Search for the profile name as a JSON key
    const searchPattern = new RegExp(`"${lastPart}"\\s*:\\s*\\{`);
    
    let targetLine = 0;
    let inCorrectParent = profileParts.length === 1; // If no nesting, any match is correct
    let parentDepth = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Track if we're inside the correct parent profile(s)
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
      
      // Look for the target profile
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

/**
 * Find and open the config file containing a specific profile, then jump to that profile.
 */
async function openAndHighlightProfile(workspaceFolder: string, profileName: string): Promise<void> {
  const layers = findConfigLayers(workspaceFolder);
  const existingLayers = layers.filter(l => l.exists);

  // Find which config file contains this profile
  for (const layer of existingLayers) {
    const config = loadConfigFile(layer.path);
    if (config?.profiles) {
      const profileNames = collectAllProfileNames(config.profiles, "");
      if (profileNames.includes(profileName)) {
        // Found it! Open and highlight
        await openProfileInEditor(layer.path, profileName);
        return;
      }
    }
  }

  // Profile not found in any config - just show a message
  vscode.window.showWarningMessage(`Profile "${profileName}" not found in any active configuration file.`);
}

/**
 * Recursively collect all profile names from a profiles object.
 */
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

/**
 * Opens all ACTIVE Zowe config files (zowe.config.json and zowe.config.user.json only).
 * Does NOT open copies, backups, or files with extra text in the name.
 */
async function openAllActiveConfigFiles(workspaceFolder: string): Promise<void> {
  const layers = findConfigLayers(workspaceFolder);
  // findConfigLayers only returns actual config locations (not copies/backups)
  const existingLayers = layers.filter(l => l.exists);
  
  if (existingLayers.length === 0) {
    vscode.window.showInformationMessage("No active Zowe configuration files found on this system.");
    return;
  }

  // Open each active config file (this triggers validation via the diagnostics provider)
  for (const layer of existingLayers) {
    try {
      const doc = await vscode.workspace.openTextDocument(layer.path);
      // Show the first one in the editor, others just open in background
      if (layer === existingLayers[0]) {
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, false);
      }
    } catch (error) {
      console.error(`Failed to open ${layer.path}:`, error);
    }
  }

  // Give the diagnostics provider time to validate the opened files
  await new Promise(resolve => setTimeout(resolve, 500));
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
      // TSO uses z/OSMF under the hood
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

async function testSshConnection(profileName: string, props: Record<string, unknown>, withAuth: boolean): Promise<void> {
  const host = String(props.host).replace(/^https?:\/\//, "");
  const port = Number(props.port) || 22;
  const startTime = Date.now();

  if (withAuth) {
    const user = props.user as string | undefined;
    const privateKey = props.privateKey as string | undefined;
    
    if (!user) {
      connectionResults.set(profileName, { 
        status: "failed", 
        message: "No user configured for auth test", 
        timestamp: Date.now() 
      });
      return;
    }
    
    // Run SSH auth test in background and capture result
    const keyOpt = privateKey ? ` -i "${privateKey}"` : "";
    const sshCmd = `ssh -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=no${keyOpt} ${user}@${host} -p ${port} echo "ok"`;
    
    try {
      const { exec } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execAsync = promisify(exec);
      
      await execAsync(sshCmd, { timeout: 20000 });
      
      const latency = Date.now() - startTime;
      connectionResults.set(profileName, { 
        status: "success", 
        message: `SSH auth successful as ${user}`, 
        latency,
        timestamp: Date.now() 
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      let friendlyMsg = `SSH auth failed`;
      
      if (errMsg.includes("Permission denied")) {
        friendlyMsg = "Auth failed: Permission denied (check key/password)";
      } else if (errMsg.includes("Connection refused")) {
        friendlyMsg = "Auth failed: Connection refused";
      } else if (errMsg.includes("timed out") || errMsg.includes("ETIMEDOUT")) {
        friendlyMsg = "Auth failed: Connection timed out";
      } else if (errMsg.includes("Host key verification")) {
        friendlyMsg = "Auth failed: Host key verification failed";
      }
      
      connectionResults.set(profileName, { 
        status: "failed", 
        message: friendlyMsg, 
        timestamp: Date.now() 
      });
    }
    return;
  }

  // Basic connectivity test (no auth)
  try {
    const net = await import("node:net");
    
    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("Connection timed out (5s)"));
      }, 5000);

      socket.connect(port, host, () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve();
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const latency = Date.now() - startTime;
    connectionResults.set(profileName, { 
      status: "success", 
      message: `Port ${port} reachable`, 
      latency,
      timestamp: Date.now() 
    });
  } catch (error) {
    connectionResults.set(profileName, { 
      status: "failed", 
      message: `Cannot reach ${host}:${port} - ${error instanceof Error ? error.message : "Unknown error"}`, 
      timestamp: Date.now() 
    });
  }
}

async function testZosmfConnection(profileName: string, props: Record<string, unknown>, withAuth: boolean): Promise<void> {
  const host = String(props.host).replace(/^https?:\/\//, "");
  const port = Number(props.port) || 443;
  const protocol = String(props.protocol || "https");
  const basePath = String(props.basePath || "/zosmf");
  const rejectUnauthorized = props.rejectUnauthorized !== false;
  const startTime = Date.now();

  if (withAuth) {
    // Auth test using Zowe CLI in background
    const zoweCmd = `zowe zosmf check status --host "${host}" --port ${port} --ru ${rejectUnauthorized}`;
    
    try {
      const { exec } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync(zoweCmd, { timeout: 30000 });
      
      const latency = Date.now() - startTime;
      
      // Parse z/OS version from output if available
      const versionMatch = stdout.match(/zos_version:\s*(\S+)/);
      const version = versionMatch ? ` (z/OS ${versionMatch[1]})` : "";
      
      connectionResults.set(profileName, { 
        status: "success", 
        message: `z/OSMF auth successful${version}`, 
        latency,
        timestamp: Date.now() 
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      let friendlyMsg = "z/OSMF auth failed";
      
      if (errMsg.includes("401") || errMsg.includes("Unauthorized") || errMsg.includes("not valid or expired")) {
        friendlyMsg = "Auth failed: Invalid credentials or expired token";
      } else if (errMsg.includes("ECONNREFUSED") || errMsg.includes("Connection refused")) {
        friendlyMsg = "Auth failed: Connection refused";
      } else if (errMsg.includes("ETIMEDOUT") || errMsg.includes("timed out")) {
        friendlyMsg = "Auth failed: Connection timed out";
      } else if (errMsg.includes("certificate") || errMsg.includes("self-signed") || errMsg.includes("CERT")) {
        friendlyMsg = "Auth failed: Certificate error (try rejectUnauthorized: false)";
      } else if (errMsg.includes("ENOTFOUND")) {
        friendlyMsg = "Auth failed: Host not found";
      }
      
      connectionResults.set(profileName, { 
        status: "failed", 
        message: friendlyMsg, 
        timestamp: Date.now() 
      });
    }
    return;
  }

  // Basic connectivity test (no auth)
  const url = `${protocol}://${host}:${port}${basePath}/info`;

  try {
    const https = await import("node:https");
    const http = await import("node:http");
    const client = protocol === "https" ? https : http;

    await new Promise<void>((resolve, reject) => {
      const req = client.request(url, {
        method: "GET",
        timeout: 10000,
        rejectUnauthorized,
      }, (res) => {
        if (res.statusCode && res.statusCode < 500) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out"));
      });
      req.end();
    });

    const latency = Date.now() - startTime;
    connectionResults.set(profileName, { 
      status: "success", 
      message: `Reachable at ${host}:${port}`, 
      latency,
      timestamp: Date.now() 
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    const hint = errMsg.includes("self-signed") || errMsg.includes("certificate") 
      ? " (set rejectUnauthorized: false)"
      : "";
    connectionResults.set(profileName, { 
      status: "failed", 
      message: `Cannot reach ${host}:${port} - ${errMsg}${hint}`, 
      timestamp: Date.now() 
    });
  }
}

async function testFtpConnection(profileName: string, props: Record<string, unknown>, withAuth: boolean): Promise<void> {
  const host = String(props.host).replace(/^https?:\/\//, "");
  const port = Number(props.port) || 21;
  const startTime = Date.now();

  if (withAuth) {
    const user = props.user as string | undefined;
    
    if (!user) {
      connectionResults.set(profileName, { 
        status: "failed", 
        message: "No user configured for auth test", 
        timestamp: Date.now() 
      });
      return;
    }
    
    // FTP auth test using Zowe CLI
    const zoweCmd = `zowe zos-ftp list data-set "${user}.*" --host "${host}" --port ${port} --user "${user}"`;
    
    try {
      const { exec } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execAsync = promisify(exec);
      
      await execAsync(zoweCmd, { timeout: 30000 });
      
      const latency = Date.now() - startTime;
      connectionResults.set(profileName, { 
        status: "success", 
        message: `FTP auth successful as ${user}`, 
        latency,
        timestamp: Date.now() 
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      let friendlyMsg = "FTP auth failed";
      
      if (errMsg.includes("530") || errMsg.includes("Login") || errMsg.includes("credentials")) {
        friendlyMsg = "Auth failed: Invalid credentials";
      } else if (errMsg.includes("ECONNREFUSED")) {
        friendlyMsg = "Auth failed: Connection refused";
      } else if (errMsg.includes("ETIMEDOUT") || errMsg.includes("timed out")) {
        friendlyMsg = "Auth failed: Connection timed out";
      } else if (errMsg.includes("not installed") || errMsg.includes("not recognized")) {
        friendlyMsg = "zFTP plugin not installed (npm i -g @zowe/zos-ftp-for-zowe-cli)";
      }
      
      connectionResults.set(profileName, { 
        status: "failed", 
        message: friendlyMsg, 
        timestamp: Date.now() 
      });
    }
    return;
  }

  // Basic FTP port connectivity test (no auth)
  try {
    const net = await import("node:net");
    
    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("Connection timed out (5s)"));
      }, 5000);

      socket.connect(port, host, () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve();
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const latency = Date.now() - startTime;
    connectionResults.set(profileName, { 
      status: "success", 
      message: `FTP port ${port} reachable`, 
      latency,
      timestamp: Date.now() 
    });
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
    
    if (i === parts.length - 1) {
      return current[part];
    }
    
    if (current[part].profiles) {
      current = current[part].profiles!;
    } else {
      return null;
    }
  }
  
  return null;
}

function getInheritedProperties(
  profiles: Record<string, ZoweConfigProfile>, 
  profileName: string
): Record<string, { value: unknown; from: string }> {
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
    
    if (current[part]?.profiles) {
      current = current[part].profiles!;
    } else {
      break;
    }
  }
  
  return inherited;
}

function updateDashboardContent(panel: vscode.WebviewPanel, workspaceFolder: string): void {
  const layers = findConfigLayers(workspaceFolder);
  const existingLayers = layers.filter(l => l.exists);
  
  const allDiagnostics: Array<{file: string; diagnostics: vscode.Diagnostic[]}> = [];
  const allProfiles: Array<{
    name: string; 
    type: string; 
    source: string;
    properties: Record<string, unknown>;
    inherited: Record<string, { value: unknown; from: string }>;
  }> = [];
  
  for (const doc of vscode.workspace.textDocuments) {
    if (isZoweConfigFile(doc.uri.fsPath)) {
      const diagnostics = vscode.languages.getDiagnostics(doc.uri)
        .filter(d => d.source === "Zowe Config Inspector");
      if (diagnostics.length > 0) {
        allDiagnostics.push({ file: doc.uri.fsPath, diagnostics });
      }
    }
  }

  for (const layer of existingLayers) {
    const config = loadConfigFile(layer.path);
    if (config?.profiles) {
      collectProfiles(config.profiles, "", layer.path, config.profiles, allProfiles);
    }
  }

  const totalErrors = allDiagnostics.reduce(
    (sum, d) => sum + d.diagnostics.filter(x => x.severity === vscode.DiagnosticSeverity.Error).length, 0
  );
  const totalWarnings = allDiagnostics.reduce(
    (sum, d) => sum + d.diagnostics.filter(x => x.severity === vscode.DiagnosticSeverity.Warning).length, 0
  );

  const envChecks = getAllEnvironmentChecks();

  panel.webview.html = generateDashboardHtml(
    existingLayers, 
    allDiagnostics, 
    allProfiles,
    totalErrors, 
    totalWarnings, 
    envChecks,
    connectionResults,
    highlightProfileName
  );
  
  // Clear the highlight after rendering
  highlightProfileName = null;
}

function collectProfiles(
  profiles: Record<string, ZoweConfigProfile>, 
  prefix: string, 
  source: string,
  rootProfiles: Record<string, ZoweConfigProfile>,
  result: Array<{
    name: string; 
    type: string; 
    source: string;
    properties: Record<string, unknown>;
    inherited: Record<string, { value: unknown; from: string }>;
  }>
): void {
  for (const [name, profile] of Object.entries(profiles)) {
    const fullName = prefix ? `${prefix}.${name}` : name;
    if (profile.type) {
      if (!result.some(p => p.name === fullName)) {
        result.push({ 
          name: fullName, 
          type: profile.type, 
          source,
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

function generateDashboardHtml(
  layers: ReturnType<typeof findConfigLayers>,
  diagnostics: Array<{file: string; diagnostics: vscode.Diagnostic[]}>,
  profiles: Array<{
    name: string; 
    type: string; 
    source: string;
    properties: Record<string, unknown>;
    inherited: Record<string, { value: unknown; from: string }>;
  }>,
  totalErrors: number,
  totalWarnings: number,
  envChecks: EnvironmentCheck[],
  connResults: Map<string, { status: string; message: string; latency?: number; timestamp: number }>,
  highlightProfile: string | null
): string {
  const statusClass = totalErrors > 0 ? "error" : totalWarnings > 0 ? "warning" : "success";
  const statusIcon = totalErrors > 0 ? "❌" : totalWarnings > 0 ? "⚠️" : "✅";
  const statusText = totalErrors > 0 
    ? `${totalErrors} Error(s), ${totalWarnings} Warning(s)`
    : totalWarnings > 0 
      ? `${totalWarnings} Warning(s)` 
      : "Configuration Valid";

  const issuesHtml = diagnostics.length > 0 
    ? diagnostics.map(({file, diagnostics: diags}) => `
        <div class="section-content">
          <div class="file-name">${escapeHtml(shortenPath(file))}</div>
          ${diags.map(d => {
            // Simplify the message - just show the main error, not the huge list of profiles
            const mainMessage = d.message.split('\n')[0];
            return `
            <div class="issue ${d.severity === 0 ? 'error' : d.severity === 1 ? 'warning' : 'info'}"
                 onclick="openFile('${escapeHtml(file.replace(/\\/g, "\\\\"))}', ${d.range.start.line}, ${d.range.start.character})">
              <span class="icon">${d.severity === 0 ? '❌' : d.severity === 1 ? '⚠️' : 'ℹ️'}</span>
              <span class="message">${escapeHtml(mainMessage)}</span>
              <span class="location">Ln ${d.range.start.line + 1}</span>
            </div>
          `;}).join('')}
        </div>
      `).join('')
    : '<div class="no-issues">✅ No issues found</div>';

  const profilesHtml = profiles.length > 0
    ? profiles.map(p => {
        const connResult = connResults.get(p.name);
        const connStatusClass = connResult?.status === "success" ? "conn-success" 
          : connResult?.status === "failed" ? "conn-failed" 
          : connResult?.status === "testing" ? "conn-testing" 
          : connResult?.status === "pending" ? "conn-pending" : "";
        
        const canTest = ["ssh", "zosmf", "tso", "zftp"].includes(p.type);
        const hasInherited = Object.keys(p.inherited).length > 0;
        const escapedSource = escapeHtml(p.source.replace(/\\/g, "\\\\"));
        const isHighlighted = highlightProfile && p.name === highlightProfile;
        const escapedName = escapeHtml(p.name);
        
        return `
          <div class="profile ${connStatusClass}${isHighlighted ? ' highlighted' : ''}" ${isHighlighted ? 'id="highlighted-profile"' : ''}>
            <div class="profile-header">
              <span class="profile-link" onclick="openProfile('${escapedSource}', '${escapedName}')" title="Jump to profile in config file">
                <span class="profile-icon">${getProfileIcon(p.type)}</span>
                <span class="profile-name">${escapedName}</span>
              </span>
              <span class="profile-type">${escapeHtml(p.type)}</span>
              ${canTest ? `
                <div class="test-btn-group">
                  <button class="test-btn" onclick="testConnection('${escapedName}', '${escapeHtml(p.type)}', false)" 
                          ${connResult?.status === "testing" ? "disabled" : ""}
                          title="Test network connectivity">
                    ${connResult?.status === "testing" ? "⏳" : "Test"}
                  </button>
                  <button class="test-btn-auth" onclick="testConnection('${escapedName}', '${escapeHtml(p.type)}', true)" 
                          ${connResult?.status === "testing" ? "disabled" : ""}
                          title="Test with authentication (opens terminal)">
                    🔐
                  </button>
                </div>
              ` : ''}
            </div>
            ${connResult ? `
              <div class="conn-result ${connResult.status}">
                <span class="conn-icon">${connResult.status === "success" ? "✅" : connResult.status === "failed" ? "❌" : connResult.status === "pending" ? "👀" : "⏳"}</span>
                <span class="conn-message">${escapeHtml(connResult.message)}</span>
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
    : '<div class="no-profiles">No profiles defined</div>';

  const envHtml = envChecks.map(c => `
    <div class="env-check ${c.status}">
      <span class="env-icon">${c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : c.status === 'warn' ? '⚠️' : '❓'}</span>
      <span class="env-name">${escapeHtml(c.name)}</span>
      <span class="env-value">${escapeHtml(c.value)}</span>
      ${c.details ? `<span class="env-details">${escapeHtml(c.details)}</span>` : ''}
      ${c.action ? `<button class="env-action" onclick="runCommand('${escapeHtml(c.action.command)}')">${escapeHtml(c.action.label)}</button>` : ''}
    </div>
  `).join('');

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
      padding: 0;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      font-size: 13px;
      line-height: 1.4;
    }
    
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      margin-bottom: 8px;
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--vscode-editor-background);
    }
    .header.success { border-bottom: 2px solid #4caf50; }
    .header.warning { border-bottom: 2px solid #ff9800; }
    .header.error { border-bottom: 2px solid #f44336; }
    .header .icon { font-size: 24px; }
    .header .text { font-size: 15px; font-weight: 600; }
    
    .container { padding: 0 16px 16px 16px; }
    
    .section { margin-bottom: 16px; }
    .section-header {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      padding: 8px 4px;
      border-bottom: 1px solid var(--vscode-panel-border);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .section-header:hover { color: var(--vscode-foreground); }
    .section-header .collapse-icon { transition: transform 0.2s; }
    .section.collapsed .collapse-icon { transform: rotate(-90deg); }
    .section.collapsed .section-content { display: none; }
    .section-content { padding: 8px 0; }
    
    .file-name {
      font-size: 11px;
      color: var(--vscode-textLink-foreground);
      margin-bottom: 4px;
      padding: 4px 0;
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
    .issue .icon { flex-shrink: 0; }
    .issue-content { flex: 1; min-width: 0; }
    .issue-content:hover .message { text-decoration: underline; }
    .issue .message { display: block; }
    .issue .hint { 
      display: block;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    .issue .location { 
      flex-shrink: 0;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-badge-background);
      padding: 2px 6px;
      border-radius: 3px;
    }
    .issue.error { border-left: 3px solid var(--vscode-errorForeground); }
    .issue.warning { border-left: 3px solid var(--vscode-editorWarning-foreground); }
    
    .no-issues, .no-profiles {
      padding: 16px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 6px;
    }
    
    .profile {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 6px;
      margin: 6px 0;
      overflow: hidden;
      transition: box-shadow 0.3s ease;
    }
    .profile.highlighted {
      box-shadow: 0 0 0 2px var(--vscode-focusBorder), 0 0 12px rgba(0, 127, 212, 0.4);
      animation: highlight-pulse 2s ease-out;
    }
    @keyframes highlight-pulse {
      0% { box-shadow: 0 0 0 2px var(--vscode-focusBorder), 0 0 20px rgba(0, 127, 212, 0.6); }
      100% { box-shadow: 0 0 0 2px var(--vscode-focusBorder), 0 0 12px rgba(0, 127, 212, 0.4); }
    }
    .profile-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
    }
    .profile-icon { font-size: 16px; }
    .profile-link {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      flex: 1;
    }
    .profile-link:hover .profile-name { 
      text-decoration: underline;
      color: var(--vscode-textLink-foreground);
    }
    .profile-name { font-weight: 600; font-size: 13px; }
    .profile-type {
      font-size: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 8px;
      border-radius: 10px;
    }
    
    .test-btn-group {
      display: inline-flex;
      border-radius: 3px;
      overflow: hidden;
    }
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
    .test-btn-auth:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
    .test-btn-auth:disabled { opacity: 0.6; cursor: not-allowed; }
    
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
    .conn-result.pending { background: rgba(255, 193, 7, 0.15); }
    .conn-message { flex: 1; }
    .conn-latency {
      font-size: 10px;
      background: var(--vscode-badge-background);
      padding: 1px 6px;
      border-radius: 3px;
    }
    
    .profile.conn-success { border-left: 3px solid #4caf50; }
    .profile.conn-failed { border-left: 3px solid #f44336; }
    .profile.conn-testing { border-left: 3px solid #2196f3; }
    .profile.conn-pending { border-left: 3px solid #ffc107; }
    
    .inherited-section {
      border-top: 1px solid var(--vscode-panel-border);
      font-size: 11px;
    }
    .inherited-section summary {
      padding: 6px 12px;
      cursor: pointer;
      color: var(--vscode-descriptionForeground);
    }
    .inherited-section summary:hover { color: var(--vscode-foreground); }
    .inherited-props { padding: 4px 12px 8px 12px; }
    .inherited-prop {
      display: flex;
      gap: 8px;
      padding: 2px 0;
    }
    .prop-name { color: var(--vscode-symbolIcon-propertyForeground); min-width: 80px; }
    .prop-value { flex: 1; color: var(--vscode-debugTokenExpression-string); }
    .prop-from { color: var(--vscode-descriptionForeground); font-size: 10px; }
    
    .env-check {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      font-size: 12px;
    }
    .env-icon { flex-shrink: 0; }
    .env-name { min-width: 110px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .env-value { flex: 1; font-family: var(--vscode-editor-font-family); font-size: 11px; }
    .env-details { 
      font-size: 10px; 
      color: var(--vscode-descriptionForeground);
      max-width: 150px;
    }
    .env-action {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 2px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      flex-shrink: 0;
    }
    .env-action:hover { background: var(--vscode-button-secondaryHoverBackground); }
    
    .footer {
      padding: 12px 16px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-align: center;
      border-top: 1px solid var(--vscode-panel-border);
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .conn-result.testing .conn-icon { animation: pulse 1s infinite; }
  </style>
</head>
<body>
  <div class="header ${statusClass}">
    <span class="icon">${statusIcon}</span>
    <span class="text">${statusText}</span>
  </div>
  
  <div class="container">
    <div class="section" id="issues-section">
      <div class="section-header" onclick="toggleSection('issues-section')">
        <span class="collapse-icon">▼</span>
        Issues
      </div>
      ${issuesHtml}
    </div>

    <div class="section" id="profiles-section">
      <div class="section-header" onclick="toggleSection('profiles-section')">
        <span class="collapse-icon">▼</span>
        Profiles (${profiles.length})
      </div>
      <div class="section-content">
        ${profilesHtml}
      </div>
    </div>

    <div class="section" id="env-section">
      <div class="section-header" onclick="toggleSection('env-section')">
        <span class="collapse-icon">▼</span>
        Environment
      </div>
      <div class="section-content">
        ${envHtml}
      </div>
    </div>
  </div>

  <div class="footer">
    Click issues to jump to editor • This panel updates automatically
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    
    function openFile(file, line, character) {
      vscode.postMessage({ command: 'openFile', file, line, character });
    }
    
    function testConnection(profileName, profileType, withAuth) {
      vscode.postMessage({ command: 'testConnection', profileName, profileType, withAuth: withAuth || false });
    }
    
    function openProfile(file, profileName) {
      vscode.postMessage({ command: 'openProfile', file, profileName });
    }
    
    function toggleSection(sectionId) {
      const section = document.getElementById(sectionId);
      section.classList.toggle('collapsed');
    }
    
    function openTerminal(cmd) {
      vscode.postMessage({ command: 'openTerminal', cmd });
    }
    
    function runCommand(cmd) {
      vscode.postMessage({ command: 'runCommand', cmd });
    }
    
    // Scroll to highlighted profile on load
    window.addEventListener('load', function() {
      const highlighted = document.getElementById('highlighted-profile');
      if (highlighted) {
        highlighted.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  </script>
</body>
</html>`;
}

function getProfileIcon(type: string): string {
  switch (type) {
    case "ssh": return "🔑";
    case "zosmf": return "🌐";
    case "base": return "📦";
    case "tso": return "🟩";  // Green screen!
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
