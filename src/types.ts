/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

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

export interface ConfigLayer {
  path: string;
  type: "global" | "project";
  userConfig: boolean;
  exists: boolean;
  profiles: string[];
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
