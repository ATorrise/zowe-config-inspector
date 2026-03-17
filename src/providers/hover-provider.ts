/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import * as vscode from "vscode";
import { isZoweConfigFile } from "../utils/config-finder.js";

const PROPERTY_DOCS: Record<string, Record<string, string>> = {
  root: {
    profiles: "Contains all connection profile definitions. Profiles define how to connect to z/OS systems.",
    defaults: "Maps profile types to default profile names. When no profile is specified, the default is used.",
    autoStore: "When true, Zowe CLI will automatically store credentials in the secure credential store.",
    $schema: "URL or path to the JSON schema for validation and autocompletion.",
  },
  profile: {
    type: "The profile type (e.g., 'ssh', 'zosmf', 'base'). Determines which properties are valid.",
    properties: "Connection properties for this profile (host, port, user, password, etc.).",
    secure: "Array of property names that should be stored securely in the credential manager.",
    profiles: "Nested profiles that inherit from this profile.",
  },
  ssh: {
    host: "The hostname or IP address of the z/OS system to connect to via SSH.",
    port: "The SSH port number (default: 22). Must be a number, not a string.",
    user: "The username for SSH authentication.",
    password: "The password for SSH authentication (if not using key-based auth).",
    privateKey: "Path to the SSH private key file (e.g., ~/.ssh/id_rsa).",
    keyPassphrase: "Passphrase for the private key if it's encrypted.",
    handshakeTimeout: "Timeout in milliseconds for the SSH handshake (default: 30000).",
  },
  zosmf: {
    host: "The hostname or IP address of the z/OSMF server.",
    port: "The z/OSMF port number (default: 443). Must be a number, not a string.",
    user: "The username for z/OSMF authentication.",
    password: "The password for z/OSMF authentication.",
    basePath: "The base path for z/OSMF API requests (default: /ibmzosmf/api/v1).",
    protocol: "The protocol to use: 'http' or 'https' (default: https).",
    rejectUnauthorized: "When false, accepts self-signed certificates. ⚠️ Insecure for production.",
    certFile: "Path to the client certificate file for certificate-based authentication.",
    certKeyFile: "Path to the client certificate key file.",
    tokenType: "The type of authentication token (e.g., 'apimlAuthenticationToken').",
    tokenValue: "The authentication token value.",
    encoding: "The encoding to use for data transfer (e.g., 'IBM-1047').",
  },
  base: {
    host: "Default hostname to use for all profile types if not overridden.",
    port: "Default port number to use for all profile types if not overridden.",
    user: "Default username to use for all profile types if not overridden.",
    password: "Default password to use for all profile types if not overridden.",
    rejectUnauthorized: "Default TLS verification setting for all profile types.",
    tokenType: "Default authentication token type.",
    tokenValue: "Default authentication token value.",
  },
};

export class ZoweConfigHoverProvider implements vscode.HoverProvider {
  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    if (!isZoweConfigFile(document.uri.fsPath)) {
      return null;
    }

    const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_$][a-zA-Z0-9_$]*/);
    if (!wordRange) {
      return null;
    }

    const word = document.getText(wordRange);
    const context = this.getPropertyContext(document, position);
    const documentation = this.getDocumentation(word, context);

    if (!documentation) {
      return null;
    }

    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`**${word}**\n\n`);
    markdown.appendMarkdown(documentation);

    return new vscode.Hover(markdown, wordRange);
  }

  private getPropertyContext(document: vscode.TextDocument, position: vscode.Position): string {
    const text = document.getText();
    const offset = document.offsetAt(position);

    let depth = 0;
    let inProfiles = false;
    let inProperties = false;
    let currentProfileType: string | null = null;

    const beforeText = text.substring(0, offset);

    if (beforeText.includes('"profiles"')) {
      inProfiles = true;
    }

    if (beforeText.includes('"properties"')) {
      inProperties = true;
    }

    const typeMatch = beforeText.match(/"type"\s*:\s*"([^"]+)"/g);
    if (typeMatch) {
      const lastTypeMatch = typeMatch[typeMatch.length - 1].match(/"type"\s*:\s*"([^"]+)"/);
      if (lastTypeMatch) {
        currentProfileType = lastTypeMatch[1];
      }
    }

    if (inProperties && currentProfileType) {
      return currentProfileType;
    }

    if (inProfiles && !inProperties) {
      return "profile";
    }

    return "root";
  }

  private getDocumentation(property: string, context: string): string | null {
    const contextDocs = PROPERTY_DOCS[context];
    if (contextDocs && contextDocs[property]) {
      return contextDocs[property];
    }

    for (const [, docs] of Object.entries(PROPERTY_DOCS)) {
      if (docs[property]) {
        return docs[property];
      }
    }

    return null;
  }
}

export function registerHoverProvider(context: vscode.ExtensionContext): void {
  const hoverProvider = new ZoweConfigHoverProvider();

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: "json", pattern: "**/zowe.config*.json" },
      hoverProvider
    )
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: "jsonc", pattern: "**/zowe.config*.json" },
      hoverProvider
    )
  );
}
