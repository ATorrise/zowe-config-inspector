/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import * as vscode from "vscode";
import type { ExtensionSettings, ValidationIssue } from "../types.js";
import { isZoweConfigFile } from "../utils/config-finder.js";
import { validateDocument } from "../validators/document-validator.js";

export class ZoweConfigDiagnosticsProvider {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection("zoweConfig");
  }

  public activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(this.diagnosticCollection);

    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        this.validateDocumentDebounced(document);
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const settings = this.getSettings();
        if (settings.enableRealTimeValidation) {
          this.validateDocumentDebounced(event.document);
        }
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        const settings = this.getSettings();
        if (settings.validateOnSave) {
          this.validateDocumentImmediate(document);
        }
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.diagnosticCollection.delete(document.uri);
        const timer = this.debounceTimers.get(document.uri.toString());
        if (timer) {
          clearTimeout(timer);
          this.debounceTimers.delete(document.uri.toString());
        }
      })
    );

    vscode.workspace.textDocuments.forEach((document) => {
      this.validateDocumentDebounced(document);
    });
  }

  private getSettings(): ExtensionSettings {
    const config = vscode.workspace.getConfiguration("zoweInspector");
    return {
      enableRealTimeValidation: config.get("enableRealTimeValidation", true),
      validateOnSave: config.get("validateOnSave", true),
      showInfoDiagnostics: config.get("showInfoDiagnostics", false),
      checkSshKeyExists: config.get("checkSshKeyExists", true),
    };
  }

  private validateDocumentDebounced(document: vscode.TextDocument): void {
    if (!this.shouldValidate(document)) {
      return;
    }

    const uri = document.uri.toString();
    const existingTimer = this.debounceTimers.get(uri);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.validateDocumentImmediate(document);
      this.debounceTimers.delete(uri);
    }, 500);

    this.debounceTimers.set(uri, timer);
  }

  public validateDocumentImmediate(document: vscode.TextDocument): void {
    if (!this.shouldValidate(document)) {
      return;
    }

    const settings = this.getSettings();
    const issues = validateDocument(document.getText(), document.uri.fsPath, settings);
    const diagnostics = this.issuesToDiagnostics(issues, document, settings);
    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  private shouldValidate(document: vscode.TextDocument): boolean {
    // Check if it's a Zowe config file by name first
    const isZoweFile = isZoweConfigFile(document.uri.fsPath);
    
    if (!isZoweFile) {
      return false;
    }
    
    // Accept json, jsonc, or even plaintext (in case language isn't detected)
    const validLanguages = ["json", "jsonc", "plaintext"];
    if (!validLanguages.includes(document.languageId)) {
      console.log(`Zowe Config Inspector: Skipping ${document.uri.fsPath} - language is ${document.languageId}`);
      return false;
    }

    console.log(`Zowe Config Inspector: Validating ${document.uri.fsPath}`);
    return true;
  }

  private issuesToDiagnostics(
    issues: ValidationIssue[],
    document: vscode.TextDocument,
    settings: ExtensionSettings
  ): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];

    for (const issue of issues) {
      if (issue.severity === "info" && !settings.showInfoDiagnostics) {
        continue;
      }

      const range = this.getRange(issue, document);
      const severity = this.getSeverity(issue.severity);

      const diagnostic = new vscode.Diagnostic(range, issue.message, severity);
      diagnostic.code = issue.code;
      diagnostic.source = "Zowe Config Inspector";


      diagnostics.push(diagnostic);
    }

    return diagnostics;
  }

  private getRange(issue: ValidationIssue, document: vscode.TextDocument): vscode.Range {
    if (issue.range) {
      return new vscode.Range(
        new vscode.Position(issue.range.startLine, issue.range.startChar),
        new vscode.Position(issue.range.endLine, issue.range.endChar)
      );
    }

    return new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(0, document.lineAt(0).text.length)
    );
  }

  private getSeverity(severity: string): vscode.DiagnosticSeverity {
    switch (severity) {
      case "error":
        return vscode.DiagnosticSeverity.Error;
      case "warning":
        return vscode.DiagnosticSeverity.Warning;
      case "info":
        return vscode.DiagnosticSeverity.Information;
      default:
        return vscode.DiagnosticSeverity.Warning;
    }
  }

  public dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.diagnosticCollection.dispose();
  }
}
