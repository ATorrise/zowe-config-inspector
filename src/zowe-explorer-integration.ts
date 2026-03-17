/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Optional integration with Zowe Explorer extension.
 * This module provides enhanced functionality when Zowe Explorer is installed.
 * 
 * Note: @zowe/zowe-explorer-api is NOT a dependency - this integration is
 * entirely optional and uses dynamic imports with runtime checks.
 */

import * as vscode from "vscode";

const ZOWE_EXPLORER_EXTENSION_ID = "zowe.vscode-extension-for-zowe";

export function isZoweExplorerInstalled(): boolean {
  const zoweExtension = vscode.extensions.getExtension(ZOWE_EXPLORER_EXTENSION_ID);
  return zoweExtension !== undefined;
}

export async function getZoweExplorerApi(): Promise<unknown | null> {
  const zoweExtension = vscode.extensions.getExtension(ZOWE_EXPLORER_EXTENSION_ID);

  if (!zoweExtension) {
    return null;
  }

  if (!zoweExtension.isActive) {
    try {
      await zoweExtension.activate();
    } catch (error) {
      console.error("Failed to activate Zowe Explorer:", error);
      return null;
    }
  }

  try {
    // Dynamic import - this will only work if @zowe/zowe-explorer-api is installed
    // which happens when Zowe Explorer is present
    const zoweApi = await import("@zowe/zowe-explorer-api").catch(() => null);
    if (!zoweApi) {
      console.log("Zowe Explorer API not available");
      return null;
    }
    
    const api = zoweApi.ZoweVsCodeExtension?.getZoweExplorerApi?.("3.0.0");
    return api || null;
  } catch {
    // Expected when Zowe Explorer API is not available
    return null;
  }
}

export async function showZoweExplorerProfiles(): Promise<void> {
  const api = await getZoweExplorerApi();

  if (!api) {
    const selection = await vscode.window.showInformationMessage(
      "Zowe Explorer is not installed. Install it for enhanced profile management.",
      "Install Zowe Explorer"
    );
    
    if (selection === "Install Zowe Explorer") {
      vscode.commands.executeCommand(
        "workbench.extensions.installExtension",
        ZOWE_EXPLORER_EXTENSION_ID
      );
    }
    return;
  }

  try {
    // Use type assertion since we can't import types without the package
    const typedApi = api as {
      getExplorerExtenderApi(): {
        getProfilesCache(): {
          getAllTypes(): string[];
          getNamesForType(type: string): Promise<string[]>;
        };
        reloadProfiles(): Promise<void>;
      };
    };

    const profilesCache = typedApi.getExplorerExtenderApi().getProfilesCache();
    const allTypes = profilesCache.getAllTypes();

    const items: vscode.QuickPickItem[] = [];

    for (const type of allTypes) {
      const names = await profilesCache.getNamesForType(type);
      for (const name of names) {
        items.push({
          label: name,
          description: type,
        });
      }
    }

    if (items.length === 0) {
      vscode.window.showInformationMessage("No profiles found in Zowe Explorer.");
      return;
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a profile from Zowe Explorer",
    });

    if (selected) {
      vscode.window.showInformationMessage(
        `Selected profile: ${selected.label} (${selected.description})`
      );
    }
  } catch (error) {
    console.error("Error accessing Zowe Explorer profiles:", error);
    vscode.window.showErrorMessage("Failed to access Zowe Explorer profiles.");
  }
}

export async function refreshZoweExplorerProfiles(): Promise<void> {
  const api = await getZoweExplorerApi();

  if (!api) {
    vscode.window.showWarningMessage("Zowe Explorer is not available.");
    return;
  }

  try {
    const typedApi = api as {
      getExplorerExtenderApi(): {
        reloadProfiles(): Promise<void>;
      };
    };

    await typedApi.getExplorerExtenderApi().reloadProfiles();
    vscode.window.showInformationMessage("Zowe Explorer profiles refreshed.");
  } catch (error) {
    console.error("Error refreshing Zowe Explorer profiles:", error);
    vscode.window.showErrorMessage("Failed to refresh Zowe Explorer profiles.");
  }
}

export function registerZoweExplorerIntegration(context: vscode.ExtensionContext): void {
  if (!isZoweExplorerInstalled()) {
    console.log("Zowe Explorer not installed, skipping integration");
    return;
  }

  console.log("Zowe Explorer detected, enabling enhanced integration");

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zoweConfigValidator.refreshZoweExplorer",
      refreshZoweExplorerProfiles
    )
  );
}
