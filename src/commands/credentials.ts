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

interface SshKeyInfo {
  name: string;
  path: string;
  type: string;
  hasPublicKey: boolean;
  size: number;
  modified: Date;
}

export async function showCredentials(): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    "zoweInspectorCredentials",
    "Zowe Inspector: Credentials & SSH Keys",
    vscode.ViewColumn.Two,
    { enableScripts: true }
  );

  const sshKeys = getSshKeyInfo();
  const credentialManagerInfo = getCredentialManagerInfo();

  panel.webview.html = generateCredentialsHtml(sshKeys, credentialManagerInfo);

  panel.webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      case "generateKey":
        await generateSshKey();
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
    }
  });
}

export async function generateSshKey(): Promise<void> {
  const keyTypes = [
    { label: "Ed25519 (Recommended)", value: "ed25519", description: "Modern, secure, fast" },
    { label: "RSA 4096", value: "rsa", description: "Wide compatibility" },
    { label: "ECDSA", value: "ecdsa", description: "Elliptic curve" },
  ];

  const selectedType = await vscode.window.showQuickPick(keyTypes, {
    placeHolder: "Select SSH key type to generate",
  });

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
      "Show Command",
      "Cancel"
    );
    if (overwrite !== "Show Command") return;
  }

  // Build the ssh-keygen command
  let cmd: string;
  switch (selectedType.value) {
    case "ed25519":
      cmd = `ssh-keygen -t ed25519 -f "${keyPath}" -C "generated-by-zowe-inspector"`;
      break;
    case "rsa":
      cmd = `ssh-keygen -t rsa -b 4096 -f "${keyPath}" -C "generated-by-zowe-inspector"`;
      break;
    case "ecdsa":
      cmd = `ssh-keygen -t ecdsa -b 521 -f "${keyPath}" -C "generated-by-zowe-inspector"`;
      break;
    default:
      cmd = `ssh-keygen -f "${keyPath}"`;
  }

  const terminal = vscode.window.createTerminal("SSH Key Generator");
  terminal.show();
  terminal.sendText(`echo "Run this command to generate your SSH key:"`);
  terminal.sendText(`echo "${cmd}"`);
  terminal.sendText(`echo ""`);
  terminal.sendText(`echo "After generating, copy the public key to your mainframe with:"`);
  terminal.sendText(`echo "ssh-copy-id -i ${keyPath}.pub user@hostname"`);
  terminal.sendText(`echo ""`);
  terminal.sendText(`echo "Or manually add the contents of ${keyPath}.pub to ~/.ssh/authorized_keys on the mainframe"`);

  vscode.window.showInformationMessage(
    `SSH key generation command shown in terminal. Review and run it manually.`,
    "Open Terminal"
  );
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

  if (!existsSync(sshDir)) {
    return keys;
  }

  try {
    const files = readdirSync(sshDir);
    const keyFiles = files.filter(f => 
      !f.endsWith(".pub") && 
      !f.includes("known_hosts") && 
      !f.includes("config") &&
      !f.includes("authorized_keys")
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

          keys.push({
            name: file,
            path: filePath,
            type: keyType,
            hasPublicKey,
            size: stat.size,
            modified: stat.mtime,
          });
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Directory read failed
  }

  return keys;
}

function getCredentialManagerInfo(): { name: string; status: string; details: string } {
  const platform = process.platform;

  switch (platform) {
    case "win32":
      return {
        name: "Windows Credential Manager",
        status: "available",
        details: "Zowe CLI uses Windows Credential Manager to securely store passwords and tokens.",
      };
    case "darwin":
      return {
        name: "macOS Keychain",
        status: "available",
        details: "Zowe CLI uses macOS Keychain to securely store passwords and tokens.",
      };
    case "linux":
      return {
        name: "libsecret (GNOME Keyring)",
        status: "check",
        details: "Zowe CLI uses libsecret on Linux. Ensure gnome-keyring or similar is installed.",
      };
    default:
      return {
        name: "Unknown",
        status: "unknown",
        details: "Platform not recognized.",
      };
  }
}

function generateCredentialsHtml(
  sshKeys: SshKeyInfo[],
  credentialManager: { name: string; status: string; details: string }
): string {
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
    : '<div class="no-keys">No SSH keys found in ~/.ssh</div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Credentials & SSH Keys</title>
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
    .section {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 16px;
    }
    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .section-title { font-weight: 600; }
    .section-status {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .section-details {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .key-item {
      background: var(--vscode-editor-background);
      border-radius: 4px;
      padding: 10px;
      margin: 8px 0;
    }
    .key-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .key-icon { font-size: 16px; }
    .key-name { font-weight: 600; flex: 1; }
    .key-type {
      font-size: 10px;
      background: var(--vscode-badge-background);
      padding: 2px 6px;
      border-radius: 3px;
    }
    .key-details {
      margin-top: 6px;
      font-size: 11px;
      display: flex;
      gap: 12px;
    }
    .key-path {
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
    }
    .key-meta { color: var(--vscode-descriptionForeground); }
    .no-keys {
      padding: 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
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
    .copy-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 3px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
    }
    .actions { margin-top: 16px; }
  </style>
</head>
<body>
  <h2>🔐 Credential Manager</h2>
  <div class="section">
    <div class="section-header">
      <span class="section-title">${escapeHtml(credentialManager.name)}</span>
      <span class="section-status">${escapeHtml(credentialManager.status)}</span>
    </div>
    <div class="section-details">${escapeHtml(credentialManager.details)}</div>
  </div>

  <h2>🔑 SSH Keys</h2>
  ${keysHtml}
  
  <div class="actions">
    <button class="action-btn" onclick="generateKey()">Generate New SSH Key</button>
    <button class="action-btn" onclick="openSshFolder()">Open ~/.ssh Folder</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    
    function generateKey() {
      vscode.postMessage({ command: 'generateKey' });
    }
    
    function openSshFolder() {
      vscode.postMessage({ command: 'openSshFolder' });
    }
    
    function copyPublicKey(keyPath) {
      vscode.postMessage({ command: 'copyPublicKey', keyPath });
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
