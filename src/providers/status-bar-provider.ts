/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import * as vscode from "vscode";
import { isZoweConfigFile } from "../utils/config-finder.js";

export class StatusBarProvider {
  private statusBarItem: vscode.StatusBarItem;
  private currentErrors = 0;
  private currentWarnings = 0;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = "zoweInspector.showDashboard";
    this.statusBarItem.name = "Zowe Config Inspector";
  }

  public activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(this.statusBarItem);

    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => this.updateStatusBar(editor))
    );

    context.subscriptions.push(
      vscode.languages.onDidChangeDiagnostics((event) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.uris.some(uri => uri.toString() === editor.document.uri.toString())) {
          this.updateStatusBar(editor);
        }
      })
    );

    this.updateStatusBar(vscode.window.activeTextEditor);
  }

  private updateStatusBar(editor: vscode.TextEditor | undefined): void {
    if (!editor || !isZoweConfigFile(editor.document.uri.fsPath)) {
      this.statusBarItem.hide();
      return;
    }

    const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
    const zoweErrors = diagnostics.filter(
      d => d.source === "Zowe Config Inspector" && d.severity === vscode.DiagnosticSeverity.Error
    );
    const zoweWarnings = diagnostics.filter(
      d => d.source === "Zowe Config Inspector" && d.severity === vscode.DiagnosticSeverity.Warning
    );

    this.currentErrors = zoweErrors.length;
    this.currentWarnings = zoweWarnings.length;

    if (this.currentErrors > 0) {
      this.statusBarItem.text = `$(error) Zowe Inspector: ${this.currentErrors} error(s)`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      this.statusBarItem.tooltip = `${this.currentErrors} error(s), ${this.currentWarnings} warning(s)\nClick to open Inspector dashboard`;
    } else if (this.currentWarnings > 0) {
      this.statusBarItem.text = `$(warning) Zowe Inspector: ${this.currentWarnings} warning(s)`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      this.statusBarItem.tooltip = `${this.currentWarnings} warning(s)\nClick to open Inspector dashboard`;
    } else {
      this.statusBarItem.text = `$(check) Zowe Inspector: Valid`;
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.tooltip = "Configuration is valid\nClick to open Inspector dashboard";
    }

    this.statusBarItem.show();
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
