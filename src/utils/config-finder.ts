/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseJsonc } from "comment-json";
import type { ConfigLayer, ZoweConfig } from "../types.js";

const CONFIG_FILE_NAME = "zowe.config.json";
const USER_CONFIG_FILE_NAME = "zowe.config.user.json";

// These are the ONLY file names that Zowe CLI actually reads
const ACTIVE_CONFIG_NAMES = [
  "zowe.config.json",
  "zowe.config.user.json",
];

export function getZoweHomePath(): string {
  return process.env.ZOWE_CLI_HOME || join(homedir(), ".zowe");
}

/**
 * Check if a file is an ACTIVE Zowe config (one that Zowe CLI will actually read).
 * This excludes copies, backups, or files with extra text in the name.
 */
export function isActiveZoweConfig(fileName: string): boolean {
  const baseName = fileName.split(/[/\\]/).pop() || "";
  return ACTIVE_CONFIG_NAMES.includes(baseName);
}

/**
 * Check if a file looks like a Zowe config (for validation purposes).
 * This is more permissive - includes copies/backups so we can still validate them if opened.
 */
export function isZoweConfigFile(fileName: string): boolean {
  const baseName = fileName.split(/[/\\]/).pop() || "";
  
  // Exact match for standard names
  if (ACTIVE_CONFIG_NAMES.includes(baseName)) {
    return true;
  }
  
  // Also match any file with "zowe" and "config" in the name (covers edge cases)
  // This allows validation of copies/backups if the user manually opens them
  const lowerName = baseName.toLowerCase();
  if (lowerName.includes("zowe") && lowerName.includes("config") && lowerName.endsWith(".json")) {
    return true;
  }
  
  return false;
}

export function findConfigLayers(cwd: string): ConfigLayer[] {
  const layers: ConfigLayer[] = [];
  const zoweHome = getZoweHomePath();

  const globalTeamConfig = join(zoweHome, CONFIG_FILE_NAME);
  layers.push({
    path: globalTeamConfig,
    type: "global",
    userConfig: false,
    exists: existsSync(globalTeamConfig),
    profiles: [],
  });

  const globalUserConfig = join(zoweHome, USER_CONFIG_FILE_NAME);
  layers.push({
    path: globalUserConfig,
    type: "global",
    userConfig: true,
    exists: existsSync(globalUserConfig),
    profiles: [],
  });

  const projectDir = resolve(cwd);
  const projectTeamConfig = join(projectDir, CONFIG_FILE_NAME);
  layers.push({
    path: projectTeamConfig,
    type: "project",
    userConfig: false,
    exists: existsSync(projectTeamConfig),
    profiles: [],
  });

  const projectUserConfig = join(projectDir, USER_CONFIG_FILE_NAME);
  layers.push({
    path: projectUserConfig,
    type: "project",
    userConfig: true,
    exists: existsSync(projectUserConfig),
    profiles: [],
  });

  for (const layer of layers) {
    if (layer.exists) {
      const config = loadConfigFile(layer.path);
      if (config?.profiles) {
        layer.profiles = extractProfileNames(config.profiles);
      }
    }
  }

  return layers;
}

export function loadConfigFile(filePath: string): ZoweConfig | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    return parseJsonc(content) as unknown as ZoweConfig;
  } catch {
    return null;
  }
}

export function parseConfigContent(content: string): ZoweConfig | null {
  try {
    return parseJsonc(content) as unknown as ZoweConfig;
  } catch {
    return null;
  }
}

function extractProfileNames(
  profiles: Record<string, unknown>,
  prefix = ""
): string[] {
  const names: string[] = [];

  for (const [name, profile] of Object.entries(profiles)) {
    const fullName = prefix ? `${prefix}.${name}` : name;
    names.push(fullName);

    if (
      profile &&
      typeof profile === "object" &&
      "profiles" in profile &&
      profile.profiles
    ) {
      names.push(
        ...extractProfileNames(
          profile.profiles as Record<string, unknown>,
          fullName
        )
      );
    }
  }

  return names;
}

export function findFirstExistingConfig(cwd: string): string | null {
  const layers = findConfigLayers(cwd);
  const existingLayers = layers.filter((l) => l.exists && !l.userConfig);

  if (existingLayers.length > 0) {
    const projectLayer = existingLayers.find((l) => l.type === "project");
    return projectLayer?.path || existingLayers[0].path;
  }

  return null;
}
