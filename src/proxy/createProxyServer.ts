import http, { type Server as HttpServer } from "node:http";
import https, { type Server as HttpsServer } from "node:https";
import { mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { StringDecoder } from "node:string_decoder";
import { Proxy, type IContext } from "http-mitm-proxy";
import {
  createBrotliDecompress,
  createGunzip,
  createInflate,
  type BrotliDecompress,
  type Gunzip,
  type Inflate,
} from "node:zlib";
import { finished } from "node:stream/promises";
import { resolveCaStorePaths } from "../ca/caStore.js";
import { isPreviewableContentType } from "../bodies/decodeBody.js";
import type { createSessionEventBus } from "../realtime/sessionEventBus.js";
import { createBodyStore } from "../storage/bodyStore.js";
import type { createSessionRepository } from "../storage/sessionRepository.js";
import type { NewSessionRecord } from "../sessions/types.js";
import { createPendingSession, finalizePendingSession } from "./sessionCollector.js";
import { startTunnelProxyServer } from "./startTunnelProxyServer.js";

const BODY_PREVIEW_LIMIT = 4096;

type DecodeStream = BrotliDecompress | Gunzip | Inflate;

const NOISE_HOSTS = [
  /connectivitycheck\.gstatic\.com$/,
  /clients\d*\.google\.com$/,
  /play\.googleapis\.com$/,
  /captive\.apple\.com$/,
  /msftconnecttest\.com$/,
  /detectportal\.firefox\.com$/,
];

const NOISE_PATHS = [/^\/generate_204$/, /^\/gen_204$/, /^\/success\.txt$/];

function isNoiseRequest(host: string, path: string): boolean {
  return NOISE_HOSTS.some((re) => re.test(host)) && NOISE_PATHS.some((re) => re.test(path));
}

function normalizeHost(value: string | undefined) {
  return value?.trim().replace(/^\[|\]$/g, "").toLowerCase() ?? "";
}

function parseTargetHostPort(requestHost: string | undefined, fallbackPort: number) {
  const normalized = normalizeHost(requestHost);
  if (!requestHost) {
    return { host: normalized, port: fallbackPort };
  }

  try {
    const parsed = new URL(`http://${requestHost}`);
    return {
      host: normalizeHost(parsed.hostname),
      port: Number(parsed.port || fallbackPort),
    };
  } catch {
    return { host: normalized, port: fallbackPort };
  }
}

function getLocalInterfaceHosts() {
  const hosts = new Set<string>();

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.address) {
        hosts.add(normalizeHost(address.address));
      }
    }
  }

  return hosts;
}

function createDecodeStream(contentEncoding: string | undefined): DecodeStream | null {
  if (contentEncoding === "gzip") {
    return createGunzip();
  }
  if (contentEncoding === "br") {
    return createBrotliDecompress();
  }
  if (contentEncoding === "deflate") {
    return createInflate();
  }
  return null;
}

function createPreviewRecorder(input: {
  contentEncoding: string | undefined;
  contentType: string | undefined;
  maxPreviewBytes: number;
}) {
  if (!isPreviewableContentType(input.contentType)) {
    return {
      write(_chunk: Buffer) {},
      async finalize() {
        return null;
      },
    };
  }

  const textDecoder = new StringDecoder("utf8");
  let preview = "";
  let previewBytes = 0;

  const appendPreview = (chunk: Buffer) => {
    if (previewBytes >= input.maxPreviewBytes) {
      return;
    }

    const slice = chunk.subarray(0, input.maxPreviewBytes - previewBytes);
    previewBytes += slice.length;
    preview += textDecoder.write(slice);
  };

  const decoder = createDecodeStream(input.contentEncoding);
  const decoderCompletion = decoder ? finished(decoder).then(() => undefined) : null;

  if (decoder) {
    decoder.on("data", (chunk) => {
      appendPreview(Buffer.from(chunk));
    });
  }

  return {
    write(chunk: Buffer) {
      if (decoder) {
        decoder.write(chunk);
        return;
      }
      appendPreview(chunk);
    },
    async finalize() {
      try {
        if (decoder && decoderCompletion) {
          decoder.end();
          await decoderCompletion;
        }
      } catch {
        return null;
      }

      return preview + textDecoder.end();
    },
  };
}

function createBodyCapture(
  bodyStore: ReturnType<typeof createBodyStore>,
  kind: "request" | "response",
  headers: {
    contentEncoding: string | undefined;
    contentType: string | undefined;
  },
) {
  const writer = bodyStore.createBodyWriter(kind);
  const previewRecorder = createPreviewRecorder({
    contentEncoding: headers.contentEncoding,
    contentType: headers.contentType,
    maxPreviewBytes: BODY_PREVIEW_LIMIT,
  });
  let pendingWrite = Promise.resolve();

  return {
    write(chunk: Buffer) {
      pendingWrite = pendingWrite.then(async () => {
        previewRecorder.write(chunk);
        await writer.write(chunk);
      });
      return pendingWrite;
    },
    async finalize() {
      await pendingWrite;
      const [bodyPath, preview] = await Promise.all([
        writer.finalize(),
        previewRecorder.finalize(),
      ]);
      return { bodyPath, preview };
    },
    async abort() {
      await writer.abort();
    },
  };
}

function storeSession(
  repository: ReturnType<typeof createSessionRepository>,
  bus: ReturnType<typeof createSessionEventBus>,
  session: NewSessionRecord,
) {
  const id = repository.insertSession(session);
  const stored = repository.getSession(id);
  if (stored) {
    bus.publish(stored);
  }
}

type ProxyDeps = {
  port: number;
  host?: string;
  httpsMode?: HttpsMode;
  repository: ReturnType<typeof createSessionRepository>;
  bus: ReturnType<typeof createSessionEventBus>;
  certificateDir: string;
  bodyDir: string;
  upstreamCaCertificates?: string[];
};

export type HttpsMode = "mitm" | "tunnel";

type ActiveSession = {
  pending: NewSessionRecord;
  startedAt: number;
  stored: boolean;
  requestCapture: ReturnType<typeof createBodyCapture>;
  responseCapture: ReturnType<typeof createBodyCapture> | null;
  requestBodyPath: string | null;
  requestBodyPreview: string | null;
  responseBodyPath: string | null;
  responseBodyPreview: string | null;
};

export async function startProxyServer({
  port,
  host = "127.0.0.1",
  httpsMode = "mitm",
  repository,
  bus,
  certificateDir,
  bodyDir,
  upstreamCaCertificates,
}: ProxyDeps) {
  if (httpsMode === "tunnel") {
    return startTunnelProxyServer({
      port,
      host,
      repository,
      bus,
      bodyDir,
    });
  }

  const caStore = resolveCaStorePaths(certificateDir);
  mkdirSync(caStore.certificateDir, { recursive: true });
  mkdirSync(bodyDir, { recursive: true });
  const bodyStore = createBodyStore(bodyDir);
  const proxy = new Proxy();
  const activeSessions = new WeakMap<IContext, ActiveSession>();
  const selfHosts = getLocalInterfaceHosts();
  let activeProxyHost = host;
  let activeProxyPort = port;

  selfHosts.add(normalizeHost(host));
  selfHosts.add("127.0.0.1");
  selfHosts.add("localhost");
  selfHosts.add("0.0.0.0");
  selfHosts.add("::1");

  proxy.onError((ctx, error, errorCode) => {
    if (!ctx) {
      return;
    }

    const active = activeSessions.get(ctx);
    if (!active || active.stored) {
      return;
    }

    active.stored = true;
    activeSessions.delete(ctx);
    void (async () => {
      if (active.requestBodyPath === null && active.requestBodyPreview === null) {
        const requestResult = await active.requestCapture.finalize();
        active.requestBodyPath = requestResult.bodyPath;
        active.requestBodyPreview = requestResult.preview;
      }

      if (active.responseCapture) {
        await active.responseCapture.abort();
      }

      storeSession(repository, bus, {
        ...active.pending,
        requestBodyPath: active.requestBodyPath,
        requestBodyPreview: active.requestBodyPreview,
        responseBodyPath: active.responseBodyPath,
        responseBodyPreview: active.responseBodyPreview,
        durationMs: Date.now() - active.startedAt,
        errorCode: errorCode ?? "UNKNOWN_PROXY_ERROR",
        errorMessage: error?.message ?? String(error ?? ""),
      });
    })();
  });

  proxy.onRequest((ctx: IContext, callback) => {
    const startedAt = Date.now();
    const request = ctx.clientToProxyRequest;
    const scheme = ctx.isSSL ? "https" : "http";
    const hostHeader = request.headers.host?.toString();
    const target = parseTargetHostPort(hostHeader, scheme === "https" ? 443 : 80);
    if (target.port === activeProxyPort && selfHosts.has(target.host)) {
      console.error({
        event: "PROXY_SELF_TARGET_BLOCKED",
        clientIp: request.socket.remoteAddress ?? "",
        method: request.method ?? "GET",
        hostHeader: hostHeader ?? "",
        requestUrl: request.url ?? "",
        targetHost: target.host,
        targetPort: target.port,
        userAgent: request.headers["user-agent"]?.toString() ?? "",
        proxyHost: activeProxyHost,
        proxyPort: activeProxyPort,
      });

      ctx.proxyToClientResponse.writeHead(508, {
        "content-type": "text/plain; charset=utf-8",
      });
      ctx.proxyToClientResponse.end(
        "Blocked proxy loop: request target resolves to the proxy itself.",
      );
      return;
    }
    const origin = `${scheme}://${hostHeader ?? "localhost"}`;
    const url = new URL(request.url ?? "/", origin);

    if (isNoiseRequest(url.host, url.pathname)) {
      return callback();
    }

    const active: ActiveSession = {
      pending: createPendingSession({
        startedAt: new Date(startedAt).toISOString(),
        scheme,
        method: request.method ?? "GET",
        host: url.host,
        path: url.pathname,
        query: url.search,
        requestHeaders: request.headers,
      }),
      startedAt,
      stored: false,
      requestCapture: createBodyCapture(bodyStore, "request", {
        contentEncoding: request.headers["content-encoding"]?.toString(),
        contentType: request.headers["content-type"]?.toString(),
      }),
      responseCapture: null,
      requestBodyPath: null,
      requestBodyPreview: null,
      responseBodyPath: null,
      responseBodyPreview: null,
    };
    activeSessions.set(ctx, active);

    ctx.onRequestData((_, chunk, done) => {
      void active.requestCapture
        .write(Buffer.from(chunk))
        .then(() => {
          done(undefined, chunk);
        })
        .catch((error) => {
          done(error as Error);
        });
    });

    ctx.onRequestEnd((_, done) => {
      void active.requestCapture
        .finalize()
        .then(({ bodyPath, preview }) => {
          active.requestBodyPath = bodyPath;
          active.requestBodyPreview = preview;
          done();
        })
        .catch((error) => {
          done(error as Error);
        });
    });

    ctx.onResponseData((_, chunk, done) => {
      if (!active.responseCapture) {
        active.responseCapture = createBodyCapture(bodyStore, "response", {
          contentEncoding: ctx.serverToProxyResponse?.headers["content-encoding"]?.toString(),
          contentType: ctx.serverToProxyResponse?.headers["content-type"]?.toString(),
        });
      }
      void active.responseCapture
        .write(Buffer.from(chunk))
        .then(() => {
          done(undefined, chunk);
        })
        .catch((error) => {
          done(error as Error);
        });
    });

    ctx.onResponseEnd((responseContext, done) => {
      if (active.stored) {
        return done();
      }

      const finalizeResponse = active.responseCapture
        ? active.responseCapture.finalize()
        : Promise.resolve({ bodyPath: null, preview: null });

      void finalizeResponse
        .then(({ bodyPath, preview }) => {
          active.stored = true;
          activeSessions.delete(ctx);
          active.responseBodyPath = bodyPath;
          active.responseBodyPreview = preview;
          const session = finalizePendingSession(active.pending, {
            requestBodyPath: active.requestBodyPath,
            requestBodyPreview: active.requestBodyPreview,
            status: responseContext.serverToProxyResponse?.statusCode ?? 0,
            headers: responseContext.serverToProxyResponse?.headers ?? {},
            responseBodyPath: bodyPath,
            durationMs: Date.now() - active.startedAt,
            responseBodyPreview: preview,
          });
          storeSession(repository, bus, session);
          done();
        })
        .catch((error) => {
          done(error as Error);
        });
    });

    return callback();
  });

  await new Promise<void>((resolve, reject) => {
    proxy.listen(
      {
        port,
        host,
        sslCaDir: caStore.caRootDir,
        httpsAgent:
          upstreamCaCertificates && upstreamCaCertificates.length > 0
            ? new https.Agent({ ca: upstreamCaCertificates })
            : undefined,
      },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });

  const address = proxy.httpServer?.address();
  const resolvedHost =
    address && typeof address !== "string"
      ? (address as AddressInfo).address
      : host;
  activeProxyHost = resolvedHost;
  activeProxyPort = proxy.httpPort;
  selfHosts.add(normalizeHost(resolvedHost));

  return {
    port: proxy.httpPort,
    host: resolvedHost,
    close: async () => {
      const serversToWait = new Set<HttpServer | HttpsServer>();
      if (proxy.httpServer) {
        serversToWait.add(proxy.httpServer);
      }
      if (proxy.httpsServer) {
        serversToWait.add(proxy.httpsServer);
      }
      for (const sslServer of Object.values(proxy.sslServers)) {
        if (sslServer.server) {
          serversToWait.add(sslServer.server);
        }
      }

      const closeWaiters = [...serversToWait].map((server) => {
        if (!server.listening) {
          return Promise.resolve();
        }

        return new Promise<void>((resolve, reject) => {
          const onClose = () => {
            cleanup();
            resolve();
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          const cleanup = () => {
            server.off("close", onClose);
            server.off("error", onError);
          };

          server.once("close", onClose);
          server.once("error", onError);
        });
      });

      proxy.close();
      const results = await Promise.allSettled(closeWaiters);
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure) {
        throw failure.reason;
      }
    },
  };
}
