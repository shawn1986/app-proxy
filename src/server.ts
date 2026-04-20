import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { appConfig, resolveAppPaths } from "./config.js";
import { registerHealthRoutes } from "./http/routes/healthRoutes.js";
import { registerSessionRoutes } from "./http/routes/sessionRoutes.js";
import { registerSetupRoutes } from "./http/routes/setupRoutes.js";
import { startProxyServer } from "./proxy/createProxyServer.js";
import { createSessionEventBus } from "./realtime/sessionEventBus.js";
import { openDatabase } from "./storage/db.js";
import { createSessionRepository } from "./storage/sessionRepository.js";
import type { SessionRecord } from "./sessions/types.js";

export async function buildApp(
  overrides: Partial<{
    dataDir: string;
    proxyPort: number;
    proxyHost: string;
    startProxy: boolean;
  }> = {},
) {
  const paths = resolveAppPaths(overrides.dataDir ?? appConfig.dataDir);
  const proxyPort = overrides.proxyPort ?? appConfig.proxyPort;
  const proxyHost = overrides.proxyHost ?? appConfig.proxyHost;
  const startProxy = overrides.startProxy ?? false;
  const moduleDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
  const publicDir = join(moduleDir, "..", "public");

  const app = Fastify();
  const db = openDatabase(paths.databasePath);
  const repository = createSessionRepository(db);
  const bus = createSessionEventBus();
  let proxyRuntime:
    | Awaited<ReturnType<typeof startProxyServer>>
    | null = null;

  app.addHook("onClose", async () => {
    if (proxyRuntime) {
      await proxyRuntime.close();
      proxyRuntime = null;
    }
    db.close();
  });

  await app.register(fastifyStatic, {
    root: publicDir,
  });

  app.get("/", async (_, reply) => reply.sendFile("index.html"));

  app.get("/api/events", async (request, reply) => {
    if (!request.headers.accept?.includes("text/event-stream")) {
      reply.header("cache-control", "no-cache");
      reply.header("content-type", "text/event-stream; charset=utf-8");
      return "";
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    });
    reply.raw.write(": connected\n\n");

    const sendSession = (session: SessionRecord) => {
      reply.raw.write(`event: session\n`);
      reply.raw.write(`data: ${JSON.stringify(session)}\n\n`);
    };

    const unsubscribe = bus.subscribe(sendSession);
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(": heartbeat\n\n");
      }
    }, 30000);

    heartbeat.unref?.();

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    });
  });

  await registerHealthRoutes(app);
  await registerSessionRoutes(app, repository);
  await registerSetupRoutes(app, { proxyPort, certificateDir: paths.certificateDir });

  if (startProxy) {
    proxyRuntime = await startProxyServer({
      port: proxyPort,
      host: proxyHost,
      repository,
      bus,
      certificateDir: paths.certificateDir,
      bodyDir: paths.bodyDir,
    });
  }

  return app;
}

export function isDirectRun(moduleUrl: string, entrypointPath?: string) {
  if (!entrypointPath) {
    return false;
  }

  return resolve(fileURLToPath(moduleUrl)) === resolve(entrypointPath);
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  const app = await buildApp({ startProxy: true });
  const closeApp = async () => {
    await app.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void closeApp();
  });
  process.once("SIGTERM", () => {
    void closeApp();
  });
  await app.listen({ host: "127.0.0.1", port: appConfig.httpPort });
}
