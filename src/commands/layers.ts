/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import * as vscode from "vscode";
import type { ConfigLayer, EffectiveProfile, PropertySource, ZoweConfig, ZoweConfigProfile } from "../types.js";
import { findConfigLayers, loadConfigFile } from "../utils/config-finder.js";

export async function showLayers(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const layers = findConfigLayers(workspaceFolder);
  const effectiveProfiles = resolveEffectiveProfiles(layers);

  const panel = vscode.window.createWebviewPanel(
    "zoweInspectorLayers",
    "Zowe Inspector: Config Layers",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = generateLayersHtml(layers, effectiveProfiles);
}

export async function showEffectiveProfile(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const layers = findConfigLayers(workspaceFolder);
  const effectiveProfiles = resolveEffectiveProfiles(layers);

  if (effectiveProfiles.size === 0) {
    vscode.window.showWarningMessage("No profiles found in any configuration layer.");
    return;
  }

  const profileNames = Array.from(effectiveProfiles.keys());
  const selected = await vscode.window.showQuickPick(profileNames, {
    placeHolder: "Select a profile to view effective configuration",
  });

  if (!selected) {
    return;
  }

  const profile = effectiveProfiles.get(selected);
  if (!profile) {
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "zoweEffectiveProfile",
    `Profile: ${selected}`,
    vscode.ViewColumn.One,
    { enableScripts: false }
  );

  panel.webview.html = generateProfileHtml(profile);
}

function resolveEffectiveProfiles(layers: ConfigLayer[]): Map<string, EffectiveProfile> {
  const effectiveProfiles = new Map<string, EffectiveProfile>();
  const orderedLayers = layers.filter((l) => l.exists);

  for (const layer of orderedLayers) {
    const config = loadConfigFile(layer.path);
    if (!config?.profiles) continue;

    processProfiles(config.profiles, layer, effectiveProfiles, "");
  }

  return effectiveProfiles;
}

function processProfiles(
  profiles: Record<string, ZoweConfigProfile>,
  layer: ConfigLayer,
  effectiveProfiles: Map<string, EffectiveProfile>,
  prefix: string
): void {
  for (const [name, profile] of Object.entries(profiles)) {
    const fullName = prefix ? `${prefix}.${name}` : name;

    let effective = effectiveProfiles.get(fullName);
    if (!effective) {
      effective = {
        name: fullName,
        type: profile.type || "unknown",
        source: layer.path,
        properties: {},
      };
      effectiveProfiles.set(fullName, effective);
    } else {
      if (!effective.overriddenBy) {
        effective.overriddenBy = [];
      }
      effective.overriddenBy.push(layer.path);
    }

    if (profile.properties) {
      for (const [propName, propValue] of Object.entries(profile.properties)) {
        const existing = effective.properties[propName];
        if (existing) {
          if (!existing.overriddenSources) {
            existing.overriddenSources = [];
          }
          existing.overriddenSources.push(existing.source);
          existing.value = propValue;
          existing.source = layer.path;
        } else {
          effective.properties[propName] = {
            value: propValue,
            source: layer.path,
          };
        }
      }
    }

    if (profile.profiles) {
      processProfiles(profile.profiles, layer, effectiveProfiles, fullName);
    }
  }
}

function generateLayersHtml(
  layers: ConfigLayer[],
  effectiveProfiles: Map<string, EffectiveProfile>
): string {
  const layersHtml = layers
    .slice()
    .reverse()
    .map((layer, index) => {
      const priority = layers.length - index;
      const statusIcon = layer.exists ? "✅" : "⬜";
      const typeLabel = layer.userConfig ? `${layer.type} user` : layer.type;

      return `
      <div class="layer ${layer.exists ? "exists" : "missing"}">
        <div class="layer-header">
          <span class="priority">${priority}.</span>
          <span class="icon">${statusIcon}</span>
          <span class="type">${escapeHtml(typeLabel)}</span>
          <span class="status">${layer.exists ? "exists" : "not found"}</span>
        </div>
        <div class="path">${escapeHtml(layer.path)}</div>
        ${layer.exists && layer.profiles.length > 0 ? `<div class="profiles">Profiles: ${escapeHtml(layer.profiles.join(", "))}</div>` : ""}
      </div>
    `;
    })
    .join("");

  const profilesHtml = Array.from(effectiveProfiles.entries())
    .map(([name, profile]) => {
      const hasOverrides = profile.overriddenBy && profile.overriddenBy.length > 0;
      return `
      <div class="profile ${hasOverrides ? "has-overrides" : ""}">
        <span class="name">${escapeHtml(name)}</span>
        <span class="type">(${escapeHtml(profile.type)})</span>
        ${hasOverrides ? `<span class="override-badge">${profile.overriddenBy!.length} override(s)</span>` : ""}
      </div>
    `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zowe Inspector: Config Layers</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }
    h1, h2 {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 10px;
    }
    .description {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 20px;
    }
    .layer {
      margin: 10px 0;
      padding: 12px;
      border-radius: 5px;
      background-color: var(--vscode-editor-inactiveSelectionBackground);
    }
    .layer.missing {
      opacity: 0.6;
    }
    .layer-header {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .priority {
      font-weight: bold;
      min-width: 25px;
    }
    .type {
      font-weight: bold;
      text-transform: capitalize;
    }
    .status {
      margin-left: auto;
      font-size: 0.9em;
    }
    .path {
      margin-top: 5px;
      font-family: monospace;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    .profiles {
      margin-top: 5px;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    .profile {
      padding: 8px 12px;
      margin: 5px 0;
      background-color: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 3px;
    }
    .profile .name {
      font-weight: bold;
      color: var(--vscode-textLink-foreground);
    }
    .profile .type {
      font-weight: normal;
      color: var(--vscode-descriptionForeground);
    }
    .override-badge {
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.8em;
      margin-left: 10px;
    }
  </style>
</head>
<body>
  <h1>📚 Configuration Layers</h1>
  <p class="description">Higher layers override lower layers. Project configs take precedence over global configs.</p>
  
  ${layersHtml}

  <h2>Effective Profiles</h2>
  <p class="description">Select a profile to see detailed property resolution.</p>
  
  ${profilesHtml.length > 0 ? profilesHtml : "<p>No profiles defined</p>"}
</body>
</html>`;
}

function generateProfileHtml(profile: EffectiveProfile): string {
  const propertiesHtml = Object.entries(profile.properties)
    .map(([name, prop]) => {
      const hasOverrides = prop.overriddenSources && prop.overriddenSources.length > 0;
      const valueStr = formatValue(prop.value);

      return `
      <tr class="${hasOverrides ? "has-override" : ""}">
        <td class="prop-name">${escapeHtml(name)}</td>
        <td class="prop-value">${escapeHtml(valueStr)}</td>
        <td class="prop-source">${escapeHtml(shortenPath(prop.source))}</td>
        <td class="prop-overrides">${hasOverrides ? `Overrides ${prop.overriddenSources!.length} source(s)` : ""}</td>
      </tr>
    `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Profile: ${escapeHtml(profile.name)}</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }
    h1 {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 10px;
    }
    .meta {
      margin-bottom: 20px;
      color: var(--vscode-descriptionForeground);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      text-align: left;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    th {
      background-color: var(--vscode-editor-inactiveSelectionBackground);
    }
    .prop-name {
      font-weight: bold;
      color: var(--vscode-textLink-foreground);
    }
    .prop-value {
      font-family: monospace;
    }
    .prop-source {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    .prop-overrides {
      font-size: 0.85em;
      color: var(--vscode-editorWarning-foreground);
    }
    .has-override {
      background-color: rgba(255, 165, 0, 0.1);
    }
  </style>
</head>
<body>
  <h1>📋 ${escapeHtml(profile.name)}</h1>
  
  <div class="meta">
    <p><strong>Type:</strong> ${escapeHtml(profile.type)}</p>
    <p><strong>Primary Source:</strong> ${escapeHtml(profile.source)}</p>
    ${profile.overriddenBy ? `<p><strong>Also defined in:</strong> ${escapeHtml(profile.overriddenBy.join(", "))}</p>` : ""}
  </div>

  <table>
    <thead>
      <tr>
        <th>Property</th>
        <th>Value</th>
        <th>Source</th>
        <th>Override Info</th>
      </tr>
    </thead>
    <tbody>
      ${propertiesHtml || "<tr><td colspan='4'>No properties defined</td></tr>"}
    </tbody>
  </table>
</body>
</html>`;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    if (value.toLowerCase().includes("password") || value.toLowerCase().includes("secret")) {
      return "[HIDDEN]";
    }
    if (value.length > 50) {
      return `"${value.substring(0, 47)}..."`;
    }
    return `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[array of ${value.length}]`;
  }
  return JSON.stringify(value);
}

function shortenPath(path: string): string {
  const parts = path.split(/[/\\]/);
  if (parts.length <= 3) {
    return path;
  }
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
