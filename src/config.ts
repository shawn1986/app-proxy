import { join, resolve } from "node:path";

export function resolveAppPaths(dataDir: string) {
  const resolvedDataDir = resolve(dataDir);
  return {
    dataDir: resolvedDataDir,
    certificateDir: join(resolvedDataDir, "certs"),
    bodyDir: join(resolvedDataDir, "bodies"),
    databasePath: join(resolvedDataDir, "sessions.db"),
  };
}

const appPaths = resolveAppPaths(process.env.DATA_DIR ?? ".data");

export const appConfig = {
  httpPort: Number(process.env.APP_PORT ?? 3000),
  proxyPort: Number(process.env.PROXY_PORT ?? 8080),
  proxyHost: process.env.PROXY_HOST ?? "0.0.0.0",
  dataDir: appPaths.dataDir,
  certificateDir: appPaths.certificateDir,
  bodyDir: appPaths.bodyDir,
  databasePath: appPaths.databasePath,
};
