/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

export interface TextRange {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
}

export function findJsonPath(content: string, jsonPath: string): TextRange | null {
  const pathParts = parseJsonPath(jsonPath);
  if (pathParts.length === 0) {
    return { startLine: 0, startChar: 0, endLine: 0, endChar: content.length };
  }

  const lines = content.split("\n");
  let currentDepth = 0;
  const pathStack: string[] = [];
  let inString = false;
  let currentKey = "";
  let keyStart: { line: number; char: number } | null = null;
  let valueStart: { line: number; char: number } | null = null;
  let collectingKey = false;
  let foundMatch = false;
  let matchRange: TextRange | null = null;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    for (let charNum = 0; charNum < line.length; charNum++) {
      const char = line[charNum];
      const prevChar = charNum > 0 ? line[charNum - 1] : "";

      if (char === '"' && prevChar !== "\\") {
        if (!inString) {
          inString = true;
          if (!collectingKey && currentKey === "") {
            collectingKey = true;
            keyStart = { line: lineNum, char: charNum };
            currentKey = "";
          }
        } else {
          inString = false;
          if (collectingKey) {
            collectingKey = false;
          }
        }
        continue;
      }

      if (inString) {
        if (collectingKey) {
          currentKey += char;
        }
        continue;
      }

      if (char === ":") {
        const fullPath = [...pathStack, currentKey].join("/");
        const targetPath = pathParts.join("/");

        if (fullPath === targetPath || `/${fullPath}` === targetPath) {
          valueStart = { line: lineNum, char: charNum + 1 };
          foundMatch = true;
        }
        continue;
      }

      if (char === "{" || char === "[") {
        if (currentKey) {
          pathStack.push(currentKey);
          currentKey = "";
        }
        currentDepth++;
        continue;
      }

      if (char === "}" || char === "]") {
        currentDepth--;
        if (foundMatch && valueStart && !matchRange) {
          matchRange = {
            startLine: keyStart?.line ?? valueStart.line,
            startChar: keyStart?.char ?? valueStart.char,
            endLine: lineNum,
            endChar: charNum + 1,
          };
        }
        pathStack.pop();
        continue;
      }

      if (char === ",") {
        if (foundMatch && valueStart && !matchRange) {
          matchRange = {
            startLine: keyStart?.line ?? valueStart.line,
            startChar: keyStart?.char ?? valueStart.char,
            endLine: lineNum,
            endChar: charNum,
          };
        }
        currentKey = "";
        keyStart = null;
        continue;
      }
    }
  }

  if (foundMatch && !matchRange && keyStart) {
    matchRange = {
      startLine: keyStart.line,
      startChar: keyStart.char,
      endLine: keyStart.line,
      endChar: keyStart.char + currentKey.length + 2,
    };
  }

  return matchRange;
}

function parseJsonPath(path: string): string[] {
  if (!path || path === "/") return [];

  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return cleanPath.split("/").filter(Boolean);
}

export function findPropertyInLine(content: string, propertyName: string): TextRange | null {
  const lines = content.split("\n");
  const searchPattern = `"${propertyName}"`;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const charIndex = line.indexOf(searchPattern);

    if (charIndex !== -1) {
      return {
        startLine: lineNum,
        startChar: charIndex,
        endLine: lineNum,
        endChar: charIndex + searchPattern.length,
      };
    }
  }

  return null;
}

export function getLineRange(lineNumber: number, content: string): TextRange {
  const lines = content.split("\n");
  const lineIndex = Math.max(0, Math.min(lineNumber - 1, lines.length - 1));
  const lineContent = lines[lineIndex] || "";

  return {
    startLine: lineIndex,
    startChar: 0,
    endLine: lineIndex,
    endChar: lineContent.length,
  };
}
