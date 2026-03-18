/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */

const PREFIX = "Zowe Inspector";

export const logger = {
  log: (...args: unknown[]) => console.log(`${PREFIX}:`, ...args),
  warn: (...args: unknown[]) => console.warn(`${PREFIX}:`, ...args),
  error: (...args: unknown[]) => console.error(`${PREFIX}:`, ...args),
  debug: (...args: unknown[]) => console.debug(`${PREFIX}:`, ...args),
};
