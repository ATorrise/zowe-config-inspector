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
import { StatusBarProvider } from "./providers/status-bar-provider.js";
import { logger } from "./utils/logger.js";

let diagnosticsProvider: ZoweConfigDiagnosticsProvider;
let statusBarProvider: StatusBarProvider;

export function activate(context: vscode.ExtensionContext): void {
  logger.log("Extension activated");

  diagnosticsProvider = new ZoweConfigDiagnosticsProvider();
  diagnosticsProvider.activate(context);

  statusBarProvider = new StatusBarProvider();
  statusBarProvider.activate(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("zoweInspector.showDashboard", () => showDashboard())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zoweInspector.validateProfile", async (node: unknown) => {
      try {
        const profileName = getProfileNameFromNode(node);
        if (profileName) {
          await showDashboardForProfile(profileName);
        } else {
          await showDashboard();
        }
      } catch (error) {
        logger.error("validateProfile failed:", error);
        vscode.window.showErrorMessage(`Failed to inspect profile: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  context.subscriptions.push({
    dispose: () => {
      diagnosticsProvider.dispose();
      statusBarProvider.dispose();
      disposeTerminal();
    },
  });
}

export function deactivate(): void {
  diagnosticsProvider?.dispose();
  statusBarProvider?.dispose();
  disposeTerminal();
}

function getProfileNameFromNode(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;

  const n = node as Record<string, unknown>;

  if (typeof n.label === "string") return n.label;

  if (n.label && typeof n.label === "object") {
    const labelObj = n.label as Record<string, unknown>;
    if (typeof labelObj.label === "string") return labelObj.label;
  }

  if (n.profile && typeof n.profile === "object") {
    const profile = n.profile as Record<string, unknown>;
    if (typeof profile.name === "string") return profile.name;
  }

  if (typeof n.getLabel === "function") {
    const label = (n.getLabel as () => unknown)();
    if (typeof label === "string") return label;
  }

  if (typeof n.getProfileName === "function") {
    const name = (n.getProfileName as () => unknown)();
    if (typeof name === "string") return name;
  }

  return null;
}
