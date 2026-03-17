/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import * as vscode from "vscode";

export interface QuickFix {
  issueCode: string;
  label: string;
  apply: (document: vscode.TextDocument, diagnostic: vscode.Diagnostic) => Promise<boolean>;
}

export const quickFixes: QuickFix[] = [
  {
    issueCode: "PORT_TYPE_ERROR",
    label: "Convert port to number",
    apply: async (document, diagnostic) => {
      const range = diagnostic.range;
      const line = document.lineAt(range.start.line);
      const lineText = line.text;
      
      // Find "port": "22" and replace with "port": 22
      const portMatch = lineText.match(/"port"\s*:\s*"(\d+)"/);
      if (portMatch) {
        const edit = new vscode.WorkspaceEdit();
        const newText = lineText.replace(/"port"\s*:\s*"(\d+)"/, `"port": $1`);
        edit.replace(document.uri, line.range, newText);
        return vscode.workspace.applyEdit(edit);
      }
      return false;
    },
  },
  {
    issueCode: "HOST_INCLUDES_PROTOCOL",
    label: "Remove protocol from host",
    apply: async (document, diagnostic) => {
      const range = diagnostic.range;
      const line = document.lineAt(range.start.line);
      const lineText = line.text;
      
      // Find "host": "https://example.com" and replace with "host": "example.com"
      const hostMatch = lineText.match(/"host"\s*:\s*"(https?:\/\/)([^"]+)"/);
      if (hostMatch) {
        const edit = new vscode.WorkspaceEdit();
        const newText = lineText.replace(/"host"\s*:\s*"https?:\/\/([^"]+)"/, `"host": "$1"`);
        edit.replace(document.uri, line.range, newText);
        return vscode.workspace.applyEdit(edit);
      }
      return false;
    },
  },
  {
    issueCode: "UNKNOWN_PROPERTY",
    label: "Rename to suggested property",
    apply: async (document, diagnostic) => {
      // Extract the suggestion from the diagnostic message
      const message = diagnostic.message;
      const suggestMatch = message.match(/Did you mean "([^"]+)"\?/);
      if (!suggestMatch) return false;
      
      const suggestedName = suggestMatch[1];
      const range = diagnostic.range;
      const line = document.lineAt(range.start.line);
      const lineText = line.text;
      
      // Find the property name and replace it
      const propMatch = lineText.match(/"([^"]+)"\s*:/);
      if (propMatch) {
        const oldName = propMatch[1];
        const edit = new vscode.WorkspaceEdit();
        const newText = lineText.replace(`"${oldName}"`, `"${suggestedName}"`);
        edit.replace(document.uri, line.range, newText);
        return vscode.workspace.applyEdit(edit);
      }
      return false;
    },
  },
  {
    issueCode: "HOST_CONTAINS_SPACE",
    label: "Remove spaces from host",
    apply: async (document, diagnostic) => {
      const range = diagnostic.range;
      const line = document.lineAt(range.start.line);
      const lineText = line.text;
      
      const hostMatch = lineText.match(/"host"\s*:\s*"([^"]+)"/);
      if (hostMatch) {
        const cleanHost = hostMatch[1].replace(/\s+/g, "");
        const edit = new vscode.WorkspaceEdit();
        const newText = lineText.replace(/"host"\s*:\s*"[^"]+"/, `"host": "${cleanHost}"`);
        edit.replace(document.uri, line.range, newText);
        return vscode.workspace.applyEdit(edit);
      }
      return false;
    },
  },
];

export function getQuickFixForCode(code: string): QuickFix | undefined {
  return quickFixes.find(qf => qf.issueCode === code);
}

export async function applyQuickFix(
  file: string, 
  line: number, 
  issueCode: string
): Promise<{ success: boolean; message: string }> {
  const quickFix = getQuickFixForCode(issueCode);
  if (!quickFix) {
    return { success: false, message: "No quick fix available for this issue" };
  }
  
  try {
    const document = await vscode.workspace.openTextDocument(file);
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    
    // Find the matching diagnostic
    const diagnostic = diagnostics.find(d => 
      d.range.start.line === line && 
      d.code === issueCode
    );
    
    if (!diagnostic) {
      return { success: false, message: "Could not find the issue to fix" };
    }
    
    const success = await quickFix.apply(document, diagnostic);
    
    if (success) {
      return { success: true, message: `Applied fix: ${quickFix.label}` };
    } else {
      return { success: false, message: "Failed to apply fix" };
    }
  } catch (error) {
    return { 
      success: false, 
      message: `Error: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
}

export function hasQuickFix(code: string | number | { value: string | number; target: unknown } | undefined): boolean {
  if (!code) return false;
  const codeStr = typeof code === "object" ? String(code.value) : String(code);
  return quickFixes.some(qf => qf.issueCode === codeStr);
}

export function getCodeString(code: string | number | { value: string | number; target: unknown } | undefined): string {
  if (!code) return "";
  return typeof code === "object" ? String(code.value) : String(code);
}
