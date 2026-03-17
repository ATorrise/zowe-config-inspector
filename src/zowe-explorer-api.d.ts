/**
 * Type declarations for optional @zowe/zowe-explorer-api dependency.
 * This allows TypeScript to compile without the package being installed.
 */

declare module "@zowe/zowe-explorer-api" {
  export const ZoweVsCodeExtension: {
    getZoweExplorerApi(minVersion: string): unknown | undefined;
  };
}
