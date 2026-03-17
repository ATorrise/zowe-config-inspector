/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { execSync } from "node:child_process";
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
  try {
    const output = execSync("zowe --version", { 
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    
    return {
      name: "Zowe CLI",
      status: "pass",
      value: `v${output}`,
    };
  } catch {
    return {
      name: "Zowe CLI",
      status: "warn",
      value: "Not installed",
      action: {
        label: "Install",
        command: "npm install -g @zowe/cli",
      },
    };
  }
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
      managerName = "libsecret";
      try {
        execSync("which secret-tool", { stdio: ["pipe", "pipe", "pipe"] });
      } catch {
        status = "warn";
        details = "libsecret may not be installed";
      }
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
  const checks: EnvironmentCheck[] = [];
  
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
    // Find private keys (files without .pub extension that have a matching .pub file, or known key names)
    const knownKeyNames = ["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"];
    const privateKeys: string[] = [];
    
    for (const file of files) {
      // Skip public keys and config files
      if (file.endsWith(".pub") || file === "known_hosts" || file === "config" || file === "authorized_keys") {
        continue;
      }
      
      // Check if it's a known key name or has a matching .pub file
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
    
    // Return each key as a separate check
    return privateKeys.map((key, index) => ({
      name: index === 0 ? "SSH Keys" : "",
      status: "pass" as const,
      value: key,
      details: existsSync(join(sshDir, `${key}.pub`)) ? "has public key" : undefined,
    }));
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
