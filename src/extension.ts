/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import * as vscode from "vscode";
import { showDashboard, showDashboardForProfile, disposeTerminal } from "./commands/dashboard.js";
import { ZoweConfigDiagnosticsProvider } from "./providers/diagnostics-provider.js";
import { registerHoverProvider } from "./providers/hover-provider.js";
import { StatusBarProvider } from "./providers/status-bar-provider.js";

let diagnosticsProvider: ZoweConfigDiagnosticsProvider;
let statusBarProvider: StatusBarProvider;

export function activate(context: vscode.ExtensionContext): void {
  console.log("Zowe Config Inspector is now active");

  // Initialize diagnostics provider (real-time validation)
  diagnosticsProvider = new ZoweConfigDiagnosticsProvider();
  diagnosticsProvider.activate(context);

  // Initialize status bar
  statusBarProvider = new StatusBarProvider();
  statusBarProvider.activate(context);

  // Register hover provider for tooltips
  registerHoverProvider(context);

  // Main command - opens the unified dashboard
  context.subscriptions.push(
    vscode.commands.registerCommand("zoweInspector.showDashboard", () => {
      showDashboard();
    })
  );

  // Legacy commands - all now redirect to dashboard (hidden from command palette)
  context.subscriptions.push(
    vscode.commands.registerCommand("zoweInspector.checkConfig", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        diagnosticsProvider.validateDocumentImmediate(editor.document);
      }
      showDashboard();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zoweInspector.showLayers", () => showDashboard())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zoweInspector.showCredentials", () => showDashboard())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zoweInspector.checkEnvironment", () => showDashboard())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zoweInspector.generateSshKey", () => showDashboard())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zoweInspector.updateCli", () => showDashboard())
  );

  // Command for Zowe Explorer tree view context menu
  context.subscriptions.push(
    vscode.commands.registerCommand("zoweInspector.validateProfile", async (node: unknown) => {
      try {
        // Extract profile name from the Zowe Explorer tree node
        const profileName = getProfileNameFromNode(node);
        console.log("Zowe Inspector: validateProfile called with node:", node, "extracted name:", profileName);
        
        if (profileName) {
          await showDashboardForProfile(profileName);
        } else {
          // Fallback to showing the dashboard without a specific profile
          await showDashboard();
        }
      } catch (error) {
        console.error("Zowe Inspector: Error in validateProfile:", error);
        vscode.window.showErrorMessage(`Failed to inspect profile: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  // Cleanup on deactivation
  context.subscriptions.push({
    dispose: () => {
      diagnosticsProvider.dispose();
      statusBarProvider.dispose();
    },
  });
}

export function deactivate(): void {
  // Dispose all resources
  if (diagnosticsProvider) {
    diagnosticsProvider.dispose();
  }
  if (statusBarProvider) {
    statusBarProvider.dispose();
  }
  // Clean up any terminal created by the extension
  disposeTerminal();
}

/**
 * Extract profile name from a Zowe Explorer tree node.
 * Zowe Explorer nodes typically have a `label` or `profile` property.
 */
function getProfileNameFromNode(node: unknown): string | null {
  if (!node || typeof node !== "object") {
    return null;
  }

  const nodeObj = node as Record<string, unknown>;

  // Try common Zowe Explorer node properties
  // The node structure varies but usually has label or profile.name
  if (typeof nodeObj.label === "string") {
    return nodeObj.label;
  }

  if (nodeObj.label && typeof nodeObj.label === "object") {
    const labelObj = nodeObj.label as Record<string, unknown>;
    if (typeof labelObj.label === "string") {
      return labelObj.label;
    }
  }

  if (nodeObj.profile && typeof nodeObj.profile === "object") {
    const profile = nodeObj.profile as Record<string, unknown>;
    if (typeof profile.name === "string") {
      return profile.name;
    }
  }

  // Try getLabel() method if it exists
  if (typeof nodeObj.getLabel === "function") {
    const label = (nodeObj.getLabel as () => unknown)();
    if (typeof label === "string") {
      return label;
    }
  }

  // Try getProfileName() method
  if (typeof nodeObj.getProfileName === "function") {
    const name = (nodeObj.getProfileName as () => unknown)();
    if (typeof name === "string") {
      return name;
    }
  }

  return null;
}
