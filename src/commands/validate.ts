/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import * as vscode from "vscode";
import type { ZoweConfigDiagnosticsProvider } from "../providers/diagnostics-provider.js";

export async function validateCurrentFile(diagnosticsProvider: ZoweConfigDiagnosticsProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showWarningMessage("No active editor. Open a zowe.config.json file to validate.");
    return;
  }

  const document = editor.document;
  const fileName = document.uri.fsPath;

  if (!fileName.includes("zowe.config")) {
    const choice = await vscode.window.showWarningMessage(
      "The current file doesn't appear to be a Zowe configuration file. Validate anyway?",
      "Yes",
      "No"
    );

    if (choice !== "Yes") {
      return;
    }
  }

  diagnosticsProvider.validateDocumentImmediate(document);

  const diagnostics = vscode.languages.getDiagnostics(document.uri);
  const errors = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
  const warnings = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning);

  if (errors.length === 0 && warnings.length === 0) {
    vscode.window.showInformationMessage("✅ Configuration is valid!");
  } else if (errors.length === 0) {
    vscode.window.showWarningMessage(
      `Configuration is valid with ${warnings.length} warning(s). Check the Problems panel.`
    );
  } else {
    vscode.window.showErrorMessage(
      `Configuration has ${errors.length} error(s) and ${warnings.length} warning(s). Check the Problems panel.`
    );
  }

  vscode.commands.executeCommand("workbench.action.problems.focus");
}
