/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import type * as vscode from "vscode";

export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  path?: string;
  file?: string;
  suggestion?: string;
  range?: {
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
}

export interface ConfigLayer {
  path: string;
  type: "global" | "project";
  userConfig: boolean;
  exists: boolean;
  profiles: string[];
}

export interface LayerResolution {
  layers: ConfigLayer[];
  effectiveProfiles: Map<string, EffectiveProfile>;
}

export interface EffectiveProfile {
  name: string;
  type: string;
  source: string;
  overriddenBy?: string[];
  properties: Record<string, PropertySource>;
}

export interface PropertySource {
  value: unknown;
  source: string;
  overriddenSources?: string[];
}

export interface ZoweConfigProfile {
  type?: string;
  properties?: Record<string, unknown>;
  secure?: string[];
  profiles?: Record<string, ZoweConfigProfile>;
}

export interface ZoweConfig {
  $schema?: string;
  profiles?: Record<string, ZoweConfigProfile>;
  defaults?: Record<string, string>;
  autoStore?: boolean;
}

export interface ExtensionSettings {
  enableRealTimeValidation: boolean;
  validateOnSave: boolean;
  showInfoDiagnostics: boolean;
  checkSshKeyExists: boolean;
}

export function severityToVscode(severity: Severity): vscode.DiagnosticSeverity {
  const vscodeModule = require("vscode") as typeof vscode;
  switch (severity) {
    case "error":
      return vscodeModule.DiagnosticSeverity.Error;
    case "warning":
      return vscodeModule.DiagnosticSeverity.Warning;
    case "info":
      return vscodeModule.DiagnosticSeverity.Information;
  }
}
