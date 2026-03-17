/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { execSync } from "node:child_process";
import * as vscode from "vscode";
import { getAllEnvironmentChecks } from "../utils/environment-checks.js";

interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  isActive: boolean;
}

export async function checkEnvironment(): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    "zoweInspectorEnvironment",
    "Zowe Inspector: Environment",
    vscode.ViewColumn.Two,
    { enableScripts: true }
  );

  const envChecks = getAllEnvironmentChecks();
  const installedExtensions = getZoweRelatedExtensions();
  const npmGlobalPackages = getNpmGlobalPackages();

  panel.webview.html = generateEnvironmentHtml(envChecks, installedExtensions, npmGlobalPackages);

  panel.webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      case "updateCli":
        await updateZoweCli();
        break;
      case "installCli":
        await installZoweCli();
        break;
      case "openTerminal":
        const terminal = vscode.window.createTerminal("Zowe Inspector");
        terminal.show();
        if (message.cmd) {
          terminal.sendText(message.cmd);
        }
        break;
      case "refresh":
        const newEnvChecks = getAllEnvironmentChecks();
        const newExtensions = getZoweRelatedExtensions();
        const newPackages = getNpmGlobalPackages();
        panel.webview.html = generateEnvironmentHtml(newEnvChecks, newExtensions, newPackages);
        break;
    }
  });
}

export async function updateZoweCli(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    "This will run 'npm update -g @zowe/cli' in a terminal. Continue?",
    "Update Zowe CLI",
    "Cancel"
  );

  if (choice !== "Update Zowe CLI") return;

  const terminal = vscode.window.createTerminal("Zowe CLI Update");
  terminal.show();
  terminal.sendText("npm update -g @zowe/cli");
  terminal.sendText("echo ''");
  terminal.sendText("echo 'Update complete. Run: zowe --version'");
}

async function installZoweCli(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    "This will run 'npm install -g @zowe/cli' in a terminal. Continue?",
    "Install Zowe CLI",
    "Cancel"
  );

  if (choice !== "Install Zowe CLI") return;

  const terminal = vscode.window.createTerminal("Zowe CLI Install");
  terminal.show();
  terminal.sendText("npm install -g @zowe/cli");
  terminal.sendText("echo ''");
  terminal.sendText("echo 'Installation complete. Run: zowe --version'");
}

function getZoweRelatedExtensions(): ExtensionInfo[] {
  const zoweExtensions: ExtensionInfo[] = [];

  for (const ext of vscode.extensions.all) {
    const id = ext.id.toLowerCase();
    if (id.includes("zowe") || id.includes("ibm") || id.includes("mainframe") || id.includes("endevor") || id.includes("cics")) {
      zoweExtensions.push({
        id: ext.id,
        name: ext.packageJSON.displayName || ext.id,
        version: ext.packageJSON.version || "unknown",
        isActive: ext.isActive,
      });
    }
  }

  return zoweExtensions.sort((a, b) => a.name.localeCompare(b.name));
}

function getNpmGlobalPackages(): Array<{ name: string; version: string }> {
  const packages: Array<{ name: string; version: string }> = [];

  try {
    const output = execSync("npm list -g --depth=0 --json", {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const parsed = JSON.parse(output);
    const deps = parsed.dependencies || {};

    for (const [name, info] of Object.entries(deps)) {
      if (name.includes("zowe") || name.includes("@brightside")) {
        packages.push({
          name,
          version: (info as { version?: string }).version || "unknown",
        });
      }
    }
  } catch {
    // npm list failed, return empty
  }

  return packages;
}

function generateEnvironmentHtml(
  envChecks: Array<{ name: string; status: string; value: string; details?: string }>,
  extensions: ExtensionInfo[],
  npmPackages: Array<{ name: string; version: string }>
): string {
  const envHtml = envChecks.map(c => `
    <div class="check-item ${c.status}">
      <span class="check-icon">${c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : c.status === 'warn' ? '⚠️' : '❓'}</span>
      <span class="check-name">${escapeHtml(c.name)}</span>
      <span class="check-value">${escapeHtml(c.value)}</span>
      ${c.details ? `<span class="check-details">${escapeHtml(c.details)}</span>` : ''}
    </div>
  `).join('');

  const extensionsHtml = extensions.length > 0
    ? extensions.map(ext => `
        <div class="ext-item">
          <span class="ext-status">${ext.isActive ? '🟢' : '⚪'}</span>
          <span class="ext-name">${escapeHtml(ext.name)}</span>
          <span class="ext-version">v${escapeHtml(ext.version)}</span>
        </div>
      `).join('')
    : '<div class="no-items">No Zowe-related extensions found</div>';

  const packagesHtml = npmPackages.length > 0
    ? npmPackages.map(pkg => `
        <div class="pkg-item">
          <span class="pkg-name">${escapeHtml(pkg.name)}</span>
          <span class="pkg-version">v${escapeHtml(pkg.version)}</span>
        </div>
      `).join('')
    : '<div class="no-items">No Zowe packages found globally</div>';

  const hasZoweCli = envChecks.some(c => c.name === "Zowe CLI" && c.status === "pass");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Environment Check</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 16px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      font-size: 13px;
    }
    h2 {
      font-size: 14px;
      font-weight: 600;
      margin: 20px 0 10px 0;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .check-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      margin: 4px 0;
      border-radius: 4px;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .check-icon { flex-shrink: 0; }
    .check-name { min-width: 140px; font-weight: 500; }
    .check-value { flex: 1; font-family: var(--vscode-editor-font-family); font-size: 12px; }
    .check-details { 
      font-size: 11px; 
      color: var(--vscode-descriptionForeground);
      max-width: 200px;
    }
    .ext-item, .pkg-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      margin: 2px 0;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 4px;
    }
    .ext-status { font-size: 10px; }
    .ext-name, .pkg-name { flex: 1; }
    .ext-version, .pkg-version {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
    }
    .no-items {
      padding: 12px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
    .actions {
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .action-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      margin: 4px;
    }
    .action-btn:hover { background: var(--vscode-button-hoverBackground); }
    .action-btn.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
  </style>
</head>
<body>
  <h2>🔧 System Environment</h2>
  ${envHtml}

  <h2>🧩 VS Code Extensions</h2>
  ${extensionsHtml}

  <h2>📦 Global NPM Packages</h2>
  ${packagesHtml}

  <div class="actions">
    ${hasZoweCli 
      ? '<button class="action-btn" onclick="updateCli()">Update Zowe CLI</button>'
      : '<button class="action-btn" onclick="installCli()">Install Zowe CLI</button>'
    }
    <button class="action-btn secondary" onclick="refresh()">Refresh</button>
    <button class="action-btn secondary" onclick="openTerminal('zowe --version')">Check CLI Version</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    
    function updateCli() {
      vscode.postMessage({ command: 'updateCli' });
    }
    
    function installCli() {
      vscode.postMessage({ command: 'installCli' });
    }
    
    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }
    
    function openTerminal(cmd) {
      vscode.postMessage({ command: 'openTerminal', cmd });
    }
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
