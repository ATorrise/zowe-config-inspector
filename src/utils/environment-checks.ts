/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";

export interface EnvironmentCheck {
  name: string;
  status: "pass" | "fail" | "warn" | "unknown";
  value: string;
  details?: string;
  action?: {
    label: string;
    command: string;
  };
}

export function getZoweHomeCheck(): EnvironmentCheck {
  const envValue = process.env.ZOWE_CLI_HOME;
  const defaultPath = join(homedir(), ".zowe");
  
  if (envValue) {
    const exists = existsSync(envValue);
    return {
      name: "ZOWE_CLI_HOME",
      status: exists ? "pass" : "warn",
      value: envValue,
      details: exists ? "Custom path" : "Path does not exist",
    };
  }
  
  const defaultExists = existsSync(defaultPath);
  return {
    name: "ZOWE_CLI_HOME",
    status: defaultExists ? "pass" : "warn",
    value: defaultExists ? defaultPath : "Not set",
    details: defaultExists ? undefined : "Run 'zowe config init --global-config'",
  };
}

export function getNodeVersionCheck(): EnvironmentCheck {
  const version = process.version;
  const majorVersion = parseInt(version.slice(1).split(".")[0], 10);
  
  const isCompatible = majorVersion >= 18;
  
  return {
    name: "Node.js",
    status: isCompatible ? "pass" : majorVersion >= 14 ? "warn" : "fail",
    value: version,
    details: isCompatible ? undefined : majorVersion >= 14 ? "Zowe CLI v3 needs Node 18+" : "Upgrade Node.js",
  };
}

export function getZoweCliVersionCheck(): EnvironmentCheck {
  // Check if Zowe CLI exists by looking for config files instead of running a command
  // This avoids spawning any processes
  const zoweHome = process.env.ZOWE_CLI_HOME || join(homedir(), ".zowe");
  const hasZoweConfig = existsSync(join(zoweHome, "zowe.config.json")) || 
                        existsSync(join(zoweHome, "zowe.config.user.json"));
  
  if (hasZoweConfig) {
    return {
      name: "Zowe CLI",
      status: "pass",
      value: "Installed",
    };
  }
  
  return {
    name: "Zowe CLI",
    status: "warn",
    value: "Not detected",
    details: "No zowe.config.json found",
    action: {
      label: "Install",
      command: "npm install -g @zowe/cli",
    },
  };
}

export function getZoweExplorerVersionCheck(): EnvironmentCheck {
  const zoweExplorerExt = vscode.extensions.getExtension("Zowe.vscode-extension-for-zowe");
  
  if (zoweExplorerExt) {
    const version = zoweExplorerExt.packageJSON?.version || "unknown";
    return {
      name: "Zowe Explorer",
      status: "pass",
      value: `v${version}`,
    };
  }
  
  return {
    name: "Zowe Explorer",
    status: "warn",
    value: "Not installed",
    action: {
      label: "Install",
      command: "ext install Zowe.vscode-extension-for-zowe",
    },
  };
}

export function getCredentialManagerCheck(): EnvironmentCheck {
  const platform = process.platform;
  
  let managerName: string;
  let status: "pass" | "warn" | "unknown" = "pass";
  let details: string | undefined;
  let action: { label: string; command: string } | undefined;
  
  switch (platform) {
    case "win32":
      managerName = "Windows Credential Manager";
      action = {
        label: "Open",
        command: "control /name Microsoft.CredentialManager",
      };
      break;
    case "darwin":
      managerName = "macOS Keychain";
      action = {
        label: "Open",
        command: "open -a 'Keychain Access'",
      };
      break;
    case "linux":
      // Don't spawn a process to check - just assume it might be there
      managerName = "libsecret";
      details = "Ensure gnome-keyring is installed";
      break;
    default:
      managerName = "Unknown";
      status = "unknown";
      details = "Platform not recognized";
  }
  
  return {
    name: "Credential Manager",
    status,
    value: managerName,
    details,
    action,
  };
}

export function getSshKeysCheck(): EnvironmentCheck[] {
  const sshDir = join(homedir(), ".ssh");
  
  if (!existsSync(sshDir)) {
    return [{
      name: "SSH Keys",
      status: "warn",
      value: "~/.ssh not found",
      details: "No SSH directory",
    }];
  }
  
  try {
    const files = readdirSync(sshDir);
    const knownKeyNames = ["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"];
    const privateKeys: string[] = [];
    
    for (const file of files) {
      if (file.endsWith(".pub") || file === "known_hosts" || file === "config" || file === "authorized_keys") {
        continue;
      }
      
      if (knownKeyNames.includes(file) || files.includes(`${file}.pub`)) {
        privateKeys.push(file);
      }
    }
    
    if (privateKeys.length === 0) {
      return [{
        name: "SSH Keys",
        status: "warn",
        value: "No keys found",
        action: {
          label: "Generate",
          command: "ssh-keygen -t ed25519",
        },
      }];
    }
    
    // Just show count, not each key
    return [{
      name: "SSH Keys",
      status: "pass",
      value: `${privateKeys.length} key(s) found`,
    }];
  } catch {
    return [{
      name: "SSH Keys",
      status: "warn",
      value: "Cannot read ~/.ssh",
    }];
  }
}

export function getAllEnvironmentChecks(): EnvironmentCheck[] {
  return [
    getZoweHomeCheck(),
    getZoweCliVersionCheck(),
    getZoweExplorerVersionCheck(),
    getNodeVersionCheck(),
    getCredentialManagerCheck(),
    ...getSshKeysCheck(),
  ];
}
