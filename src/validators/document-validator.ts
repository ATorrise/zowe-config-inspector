/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize } from "node:path";
import { parse as parseJsonc } from "comment-json";
import type { ExtensionSettings, ValidationIssue, ZoweConfig, ZoweConfigProfile } from "../types.js";
import { findJsonPath, findPropertyInLine, getLineRange } from "../utils/position-finder.js";

export function validateDocument(
  content: string,
  filePath: string,
  settings: ExtensionSettings
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const syntaxIssues = validateSyntax(content, filePath);
  issues.push(...syntaxIssues);

  if (syntaxIssues.some((i) => i.severity === "error")) {
    return issues;
  }

  let config: ZoweConfig;
  try {
    config = parseJsonc(content) as unknown as ZoweConfig;
  } catch {
    return issues;
  }

  issues.push(...validateSchema(config, content, filePath));
  issues.push(...validateProfiles(config, content, filePath, settings));

  return issues;
}

function validateSyntax(content: string, filePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (content.trim().length === 0) {
    issues.push({
      severity: "error",
      code: "FILE_EMPTY",
      message: "Configuration file is empty",
      file: filePath,
      suggestion: 'Add configuration content or run "zowe config init" to generate one.',
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 },
    });
    return issues;
  }

  try {
    parseJsonc(content);
  } catch (err) {
    const error = err as Error;
    const parseError = extractJsonParseError(error.message, content);

    issues.push({
      severity: "error",
      code: "JSON_PARSE_ERROR",
      message: `Invalid JSON: ${parseError.message}`,
      file: filePath,
      suggestion: parseError.suggestion,
      range: parseError.range,
    });
    return issues;
  }

  issues.push(...checkCommonSyntaxIssues(content, filePath));

  return issues;
}

interface ParseErrorInfo {
  message: string;
  suggestion?: string;
  range: { startLine: number; startChar: number; endLine: number; endChar: number };
}

function extractJsonParseError(errorMessage: string, content: string): ParseErrorInfo {
  const positionMatch = errorMessage.match(/position\s+(\d+)/i);
  const lineColMatch = errorMessage.match(/line\s+(\d+)\s+column\s+(\d+)/i);

  let line = 0;
  let column = 0;

  if (lineColMatch) {
    line = parseInt(lineColMatch[1], 10) - 1;
    column = parseInt(lineColMatch[2], 10) - 1;
  } else if (positionMatch) {
    const position = parseInt(positionMatch[1], 10);
    const result = positionToLineColumn(content, position);
    line = result.line;
    column = result.column;
  }

  let suggestion: string | undefined;

  if (errorMessage.includes("Unexpected token")) {
    if (errorMessage.includes("Unexpected token }")) {
      suggestion = "Check for a trailing comma before the closing brace.";
    } else if (errorMessage.includes("Unexpected token ]")) {
      suggestion = "Check for a trailing comma before the closing bracket.";
    } else if (errorMessage.includes("Unexpected token ,")) {
      suggestion = "Check for a missing value or double comma.";
    } else {
      suggestion = "Check for missing quotes, commas, or brackets near this position.";
    }
  } else if (errorMessage.includes("Unexpected end")) {
    suggestion = "The JSON appears incomplete. Check for missing closing braces or brackets.";
  }

  const lines = content.split("\n");
  const lineLength = lines[line]?.length || 0;

  return {
    message: errorMessage,
    suggestion,
    range: {
      startLine: line,
      startChar: column,
      endLine: line,
      endChar: Math.min(column + 10, lineLength),
    },
  };
}

function positionToLineColumn(content: string, position: number): { line: number; column: number } {
  const lines = content.substring(0, position).split("\n");
  return {
    line: lines.length - 1,
    column: lines[lines.length - 1].length,
  };
}

function checkCommonSyntaxIssues(content: string, filePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const smartQuoteMatch = line.match(/[\u201C\u201D\u2018\u2019]/);
    if (smartQuoteMatch) {
      issues.push({
        severity: "error",
        code: "SMART_QUOTES",
        message: "Smart quotes (curly quotes) detected - use straight quotes instead",
        file: filePath,
        suggestion: 'Replace curly quotes with straight quotes (").',
        range: {
          startLine: i,
          startChar: line.indexOf(smartQuoteMatch[0]),
          endLine: i,
          endChar: line.indexOf(smartQuoteMatch[0]) + 1,
        },
      });
    }
  }

  if (content.charCodeAt(0) === 0xfeff) {
    issues.push({
      severity: "warning",
      code: "BOM_DETECTED",
      message: "File contains a UTF-8 BOM (Byte Order Mark)",
      file: filePath,
      suggestion: "Some tools may have issues with BOM. Consider removing it.",
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 1 },
    });
  }

  return issues;
}

function validateSchema(config: ZoweConfig, content: string, filePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    issues.push({
      severity: "error",
      code: "INVALID_ROOT_TYPE",
      message: "Configuration must be a JSON object",
      file: filePath,
      suggestion: 'The root should be an object like { "profiles": {...} }',
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 1 },
    });
    return issues;
  }

  const allowedTopLevel = ["$schema", "profiles", "defaults", "autoStore"];
  for (const key of Object.keys(config)) {
    if (!allowedTopLevel.includes(key)) {
      const range = findPropertyInLine(content, key);
      issues.push({
        severity: "warning",
        code: "UNKNOWN_TOP_LEVEL_PROPERTY",
        message: `Unknown top-level property: "${key}"`,
        file: filePath,
        path: `/${key}`,
        suggestion: `Valid top-level properties are: ${allowedTopLevel.join(", ")}`,
        range: range || undefined,
      });
    }
  }

  return issues;
}

function validateProfiles(
  config: ZoweConfig,
  content: string,
  filePath: string,
  settings: ExtensionSettings
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!config.profiles) {
    issues.push({
      severity: "info",
      code: "NO_PROFILES",
      message: "No profiles defined in configuration",
      file: filePath,
      suggestion: 'Add profiles under the "profiles" key to define connections.',
      range: findJsonPath(content, "/") || undefined,
    });
    return issues;
  }

  const allProfileNames = extractAllProfileNames(config.profiles);

  if (config.defaults) {
    for (const [type, profileName] of Object.entries(config.defaults)) {
      if (!allProfileNames.includes(profileName)) {
        const range = findPropertyInLine(content, profileName) || findPropertyInLine(content, type);
        issues.push({
          severity: "error",
          code: "DEFAULT_PROFILE_NOT_FOUND",
          message: `Default profile "${profileName}" for type "${type}" does not exist`,
          file: filePath,
          path: `/defaults/${type}`,
          suggestion: `Available profiles: ${allProfileNames.join(", ") || "none"}`,
          range: range || undefined,
        });
      }
    }
  }

  issues.push(...validateProfilesRecursive(config.profiles, content, filePath, "", allProfileNames, settings));

  return issues;
}

function validateProfilesRecursive(
  profiles: Record<string, ZoweConfigProfile>,
  content: string,
  filePath: string,
  prefix: string,
  allProfileNames: string[],
  settings: ExtensionSettings
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [name, profile] of Object.entries(profiles)) {
    const fullPath = prefix ? `${prefix}.${name}` : name;
    const jsonPath = `/profiles/${fullPath.replace(/\./g, "/profiles/")}`;

    if (!profile.type && !profile.properties && !profile.profiles) {
      const range = findPropertyInLine(content, name);
      issues.push({
        severity: "warning",
        code: "EMPTY_PROFILE",
        message: `Profile "${fullPath}" appears to be empty`,
        file: filePath,
        path: jsonPath,
        suggestion: "Add a type and properties, or remove the profile.",
        range: range || undefined,
      });
    }

    if (profile.properties) {
      issues.push(...validateProfileProperties(fullPath, profile, content, filePath, settings));
    }

    // Note: Secure properties are stored in credential manager, NOT in the JSON file.
    // So it's actually CORRECT for secure properties to NOT be in the properties section.
    // We only warn if a property is in BOTH secure AND properties (potential exposure risk)
    if (profile.secure && profile.properties) {
      for (const secureProp of profile.secure) {
        if (secureProp in profile.properties) {
          const range = findPropertyInLine(content, secureProp);
          issues.push({
            severity: "warning",
            code: "SECURE_PROPERTY_IN_PLAINTEXT",
            message: `Profile "${fullPath}": "${secureProp}" is marked secure but also in properties (may be exposed)`,
            file: filePath,
            path: `${jsonPath}/properties/${secureProp}`,
            suggestion: `Remove "${secureProp}" from properties - it should only be in the secure credential store.`,
            range: range || undefined,
          });
        }
      }
    }

    if (profile.profiles) {
      issues.push(
        ...validateProfilesRecursive(profile.profiles, content, filePath, fullPath, allProfileNames, settings)
      );
    }
  }

  return issues;
}

function validateProfileProperties(
  profileName: string,
  profile: ZoweConfigProfile,
  content: string,
  filePath: string,
  settings: ExtensionSettings
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const properties = profile.properties || {};
  const profileType = profile.type;

  if (typeof properties.port === "string") {
    const range = findPropertyInLine(content, "port");
    issues.push({
      severity: "error",
      code: "PORT_TYPE_ERROR",
      message: `Profile "${profileName}": port should be a number, not a string`,
      file: filePath,
      path: `/profiles/${profileName}/properties/port`,
      suggestion: `Change "port": "${properties.port}" to "port": ${properties.port}`,
      range: range || undefined,
    });
  }

  if (properties.host && typeof properties.host === "string") {
    const host = properties.host;

    if (host.includes("://")) {
      const range = findPropertyInLine(content, "host");
      issues.push({
        severity: "error",
        code: "HOST_INCLUDES_PROTOCOL",
        message: `Profile "${profileName}": host should not include protocol`,
        file: filePath,
        path: `/profiles/${profileName}/properties/host`,
        suggestion: "Remove http:// or https:// from the host value.",
        range: range || undefined,
      });
    }

    if (host.includes(" ")) {
      const range = findPropertyInLine(content, "host");
      issues.push({
        severity: "error",
        code: "HOST_CONTAINS_SPACE",
        message: `Profile "${profileName}": host contains spaces`,
        file: filePath,
        path: `/profiles/${profileName}/properties/host`,
        suggestion: "Remove spaces from the hostname.",
        range: range || undefined,
      });
    }

    if (host === "localhost" || host === "127.0.0.1") {
      const range = findPropertyInLine(content, "host");
      issues.push({
        severity: "info",
        code: "LOCALHOST_HOST",
        message: `Profile "${profileName}": host is set to localhost`,
        file: filePath,
        path: `/profiles/${profileName}/properties/host`,
        suggestion: "This is unusual for a mainframe connection. Is this intentional?",
        range: range || undefined,
      });
    }
  }

  if (profileType === "ssh") {
    if (properties.privateKey && properties.password) {
      const range = findPropertyInLine(content, "privateKey");
      issues.push({
        severity: "info",
        code: "SSH_DUAL_AUTH",
        message: `Profile "${profileName}": both privateKey and password are set`,
        file: filePath,
        path: `/profiles/${profileName}/properties`,
        suggestion: "privateKey will be tried first. Consider removing one for clarity.",
        range: range || undefined,
      });
    }

    if (settings.checkSshKeyExists && properties.privateKey && typeof properties.privateKey === "string") {
      const keyPath = expandPath(properties.privateKey);
      if (!existsSync(keyPath)) {
        const range = findPropertyInLine(content, "privateKey");
        issues.push({
          severity: "error",
          code: "SSH_KEY_NOT_FOUND",
          message: `Profile "${profileName}": private key file not found`,
          file: filePath,
          path: `/profiles/${profileName}/properties/privateKey`,
          suggestion: `Verify the path exists: ${keyPath}`,
          range: range || undefined,
        });
      }
    }
  }

  if (profileType === "zosmf" || profileType === "base") {
    if (properties.rejectUnauthorized === false) {
      const range = findPropertyInLine(content, "rejectUnauthorized");
      issues.push({
        severity: "warning",
        code: "TLS_VERIFICATION_DISABLED",
        message: `Profile "${profileName}": TLS certificate verification is disabled`,
        file: filePath,
        path: `/profiles/${profileName}/properties/rejectUnauthorized`,
        suggestion: "This is insecure for production. Consider enabling certificate verification.",
        range: range || undefined,
      });
    }
  }

  // Only check for unknown properties if we have a known profile type
  // Custom/extension properties are allowed - we only warn about likely typos
  const knownProperties = getKnownPropertiesForType(profileType);
  if (knownProperties.length > 0) {
    for (const prop of Object.keys(properties)) {
      if (!knownProperties.includes(prop)) {
        // Check if it looks like a typo of a known property
        const similar = findSimilarProperty(prop, knownProperties);
        if (similar) {
          // Only warn if it's a likely typo (very similar to a known property)
          const range = findPropertyInLine(content, prop);
          issues.push({
            severity: "info",  // Downgrade to info since it might be intentional
            code: "POSSIBLE_TYPO",
            message: `Profile "${profileName}": "${prop}" might be a typo`,
            file: filePath,
            path: `/profiles/${profileName}/properties/${prop}`,
            suggestion: `Did you mean "${similar}"? Ignore if this is a custom property.`,
            range: range || undefined,
          });
        }
        // Don't warn about truly unknown properties - they could be from plugins/extensions
      }
    }
  }

  return issues;
}

function getKnownPropertiesForType(type?: string): string[] {
  // Common properties that can appear on any profile type
  const common = ["host", "port", "user", "password", "rejectUnauthorized", "tokenType", "tokenValue", "authOrder", "protocol"];
  
  switch (type) {
    case "ssh":
      return [...common, "privateKey", "keyPassphrase", "handshakeTimeout"];
    case "zosmf":
      return [...common, "basePath", "certFile", "certKeyFile", "encoding"];
    case "base":
      return [...common, "encoding"];
    case "tso":
      return [...common, "account", "codePage", "logonProcedure", "regionSize", "characterSet"];
    case "zftp":
      return [...common, "secureFtp", "connectionTimeout"];
    default:
      // For unknown profile types (plugins, extensions), don't warn about unknown properties
      // since we don't know what properties they support
      return [];
  }
}

function findSimilarProperty(input: string, known: string[]): string | null {
  const inputLower = input.toLowerCase();

  for (const prop of known) {
    if (prop.toLowerCase() === inputLower) {
      return prop;
    }
  }

  for (const prop of known) {
    if (levenshteinDistance(inputLower, prop.toLowerCase()) <= 2) {
      return prop;
    }
  }

  return null;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[b.length][a.length];
}

function extractAllProfileNames(profiles: Record<string, ZoweConfigProfile>, prefix = ""): string[] {
  const names: string[] = [];

  for (const [name, profile] of Object.entries(profiles)) {
    const fullName = prefix ? `${prefix}.${name}` : name;
    names.push(fullName);

    if (profile.profiles) {
      names.push(...extractAllProfileNames(profile.profiles, fullName));
    }
  }

  return names;
}

function expandPath(inputPath: string): string {
  if (inputPath.startsWith("~")) {
    return normalize(join(homedir(), inputPath.slice(1)));
  }
  return normalize(inputPath);
}
