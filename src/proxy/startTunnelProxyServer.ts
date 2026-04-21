import http from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { StringDecoder } from "node:string_decoder";
import {
  createBrotliDecompress,
  createGunzip,
  createInflate,
  type BrotliDecompress,
  type Gunzip,
  type Inflate,
} from "node:zlib";
import { finished } from "node:stream/promises";
import { isPreviewableContentType } from "../bodies/decodeBody.js";
import type { createSessionEventBus } from "../realtime/sessionEventBus.js";
import type { NewSessionRecord } from "../sessions/types.js";
import { createBodyStore } from "../storage/bodyStore.js";
import type { createSessionRepository } from "../storage/sessionRepository.js";
import { createPendingSession, finalizePendingSession } from "./sessionCollector.js";

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
const PROXY_ONLY_REQUEST_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

type TunnelProxyDeps = {
  port: number;
  host?: string;
  repository: ReturnType<typeof createSessionRepository>;
  bus: ReturnType<typeof createSessionEventBus>;
  bodyDir: string;
};

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

function isNoiseRequest(host: string, path: string): boolean {
  return NOISE_HOSTS.some((re) => re.test(host)) && NOISE_PATHS.some((re) => re.test(path));
}

function isNoiseConnectHost(host: string): boolean {
  return NOISE_HOSTS.some((re) => re.test(host));
}

function toAbsoluteTargetUrl(request: http.IncomingMessage) {
  const rawUrl = request.url ?? "/";
  if (/^https?:\/\//i.test(rawUrl)) {
    return new URL(rawUrl);
  }
  return new URL(rawUrl, `http://${request.headers.host ?? "localhost"}`);
}

function sanitizeUpstreamRequestHeaders(headers: http.IncomingHttpHeaders) {
  const sanitized: http.OutgoingHttpHeaders = { ...headers };
  const connectionHeader = Array.isArray(headers.connection)
    ? headers.connection.join(",")
    : (headers.connection ?? "");
  const connectionTokens = connectionHeader
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  for (const token of connectionTokens) {
    delete sanitized[token];
  }

  for (const header of PROXY_ONLY_REQUEST_HEADERS) {
    delete sanitized[header];
  }

  return sanitized;
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
      const [bodyPath, preview] = await Promise.all([writer.finalize(), previewRecorder.finalize()]);
      return { bodyPath, preview };
    },
    async abort() {
      await writer.abort();
    },
  };
}

export async function startTunnelProxyServer({
  port,
  host = "127.0.0.1",
  repository,
  bus,
  bodyDir,
}: TunnelProxyDeps) {
  const selfHosts = getLocalInterfaceHosts();
  const bodyStore = createBodyStore(bodyDir);
  const activeSockets = new Set<net.Socket>();
  const activeTunnelSockets = new Set<net.Socket>();
  let activeProxyHost = host;
  let activeProxyPort = port;

  selfHosts.add(normalizeHost(host));
  selfHosts.add("127.0.0.1");
  selfHosts.add("localhost");
  selfHosts.add("0.0.0.0");
  selfHosts.add("::1");

  const trackSocket = (target: Set<net.Socket>, socket: net.Socket) => {
    target.add(socket);
    socket.once("close", () => {
      target.delete(socket);
    });
  };

  const server = http.createServer((request, response) => {
    const startedAt = Date.now();
    const targetUrl = toAbsoluteTargetUrl(request);
    const targetPort = Number(targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80));
    const targetHost = normalizeHost(targetUrl.hostname);

    if (targetPort === activeProxyPort && selfHosts.has(targetHost)) {
      console.error({
        event: "PROXY_SELF_TARGET_BLOCKED",
        clientIp: request.socket.remoteAddress ?? "",
        method: request.method ?? "GET",
        hostHeader: request.headers.host?.toString() ?? "",
        requestUrl: request.url ?? "",
        targetHost,
        targetPort,
        userAgent: request.headers["user-agent"]?.toString() ?? "",
        proxyHost: activeProxyHost,
        proxyPort: activeProxyPort,
      });
      response.writeHead(508, { "content-type": "text/plain; charset=utf-8" });
      response.end("Blocked proxy loop: request target resolves to the proxy itself.");
      return;
    }

    const shouldCapture = !isNoiseRequest(targetUrl.host, targetUrl.pathname);

    const pending = createPendingSession({
      startedAt: new Date(startedAt).toISOString(),
      scheme: targetUrl.protocol === "https:" ? "https" : "http",
      method: request.method ?? "GET",
      host: targetUrl.host,
      path: targetUrl.pathname,
      query: targetUrl.search,
      requestHeaders: request.headers,
    });
    const requestCapture = shouldCapture
      ? createBodyCapture(bodyStore, "request", {
          contentEncoding: request.headers["content-encoding"]?.toString(),
          contentType: request.headers["content-type"]?.toString(),
        })
      : null;

    let stored = false;
    let requestBodyPath: string | null = null;
    let requestBodyPreview: string | null = null;
    let responseBodyPath: string | null = null;
    let responseBodyPreview: string | null = null;
    let requestFinalizePromise:
      | Promise<{ bodyPath: string | null; preview: string | null }>
      | null = null;
    let resolveRequestLifecycle = () => {};
    const requestLifecycleDone = new Promise<void>((resolve) => {
      resolveRequestLifecycle = resolve;
    });
    let requestLifecycleMarkedDone = false;
    const toErrorMessage = (error: unknown) =>
      error instanceof Error ? error.message : String(error);
    const markRequestLifecycleDone = () => {
      if (requestLifecycleMarkedDone) {
        return;
      }
      requestLifecycleMarkedDone = true;
      resolveRequestLifecycle();
    };
    const storeBodyCaptureFailure = (error: unknown) => {
      if (!shouldCapture) {
        return;
      }
      storeSession(repository, bus, {
        ...pending,
        requestBodyPath,
        requestBodyPreview,
        responseBodyPath,
        responseBodyPreview,
        durationMs: Date.now() - startedAt,
        errorCode: "BODY_CAPTURE_ERROR",
        errorMessage: toErrorMessage(error),
      });
    };

    const finalizeRequestCapture = async () => {
      if (!requestCapture) {
        return { bodyPath: null, preview: null };
      }
      if (!requestFinalizePromise) {
        requestFinalizePromise = requestCapture.finalize();
      }
      const result = await requestFinalizePromise;
      requestBodyPath = result.bodyPath;
      requestBodyPreview = result.preview;
      return result;
    };
    const finalizeRequestCaptureAfterRequestLifecycle = async () => {
      await requestLifecycleDone;
      return finalizeRequestCapture();
    };

    const requestFn = targetUrl.protocol === "https:" ? https.request : http.request;
    const upstreamRequestHeaders = sanitizeUpstreamRequestHeaders(request.headers);
    const upstream = requestFn(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetPort,
        method: request.method,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        headers: upstreamRequestHeaders,
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 500,
          upstreamResponse.statusMessage,
          upstreamResponse.headers,
        );

        const responseCapture = shouldCapture
          ? createBodyCapture(bodyStore, "response", {
              contentEncoding: upstreamResponse.headers["content-encoding"]?.toString(),
              contentType: upstreamResponse.headers["content-type"]?.toString(),
            })
          : null;
        let waitingForDrain = false;
        const onDrain = () => {
          waitingForDrain = false;
          upstreamResponse.resume();
        };

        response.once("close", () => {
          if (waitingForDrain) {
            response.off("drain", onDrain);
          }
          if (!response.writableEnded) {
            upstreamResponse.destroy();
            upstream.destroy();
          }
        });

        upstreamResponse.on("data", (chunk) => {
          const buffer = Buffer.from(chunk);
          if (responseCapture) {
            void responseCapture.write(buffer).catch(() => {});
          }
          if (response.write(buffer)) {
            return;
          }

          if (!waitingForDrain) {
            waitingForDrain = true;
            upstreamResponse.pause();
            response.once("drain", onDrain);
          }
        });

        const storeUpstreamResponseFailure = async (errorMessage: string) => {
          if (stored) {
            return;
          }
          stored = true;
          if (!shouldCapture) {
            return;
          }

          let captureFailure = "";
          try {
            await finalizeRequestCaptureAfterRequestLifecycle();
          } catch (captureError) {
            captureFailure += `; request capture finalize failed: ${toErrorMessage(captureError)}`;
          }

          try {
            if (responseCapture) {
              const responseResult = await responseCapture.finalize();
              responseBodyPath = responseResult.bodyPath;
              responseBodyPreview = responseResult.preview;
            }
          } catch (captureError) {
            captureFailure += `; response capture finalize failed: ${toErrorMessage(captureError)}`;
          }

          const finalized = finalizePendingSession(pending, {
            requestBodyPath,
            requestBodyPreview,
            status: upstreamResponse.statusCode ?? 0,
            headers: upstreamResponse.headers,
            responseBodyPath,
            durationMs: Date.now() - startedAt,
            responseBodyPreview,
          });
          storeSession(repository, bus, {
            ...finalized,
            errorCode: "PROXY_TO_SERVER_REQUEST_ERROR",
            errorMessage: `${errorMessage}${captureFailure}`,
          });
        };

        upstreamResponse.on("end", async () => {
          response.end();
          if (stored) {
            return;
          }
          stored = true;
          if (!shouldCapture) {
            return;
          }
          try {
            await finalizeRequestCaptureAfterRequestLifecycle();
            if (responseCapture) {
              const responseResult = await responseCapture.finalize();
              responseBodyPath = responseResult.bodyPath;
              responseBodyPreview = responseResult.preview;
            }
            storeSession(
              repository,
              bus,
              finalizePendingSession(pending, {
                requestBodyPath,
                requestBodyPreview,
                status: upstreamResponse.statusCode ?? 0,
                headers: upstreamResponse.headers,
                responseBodyPath,
                durationMs: Date.now() - startedAt,
                responseBodyPreview,
              }),
            );
          } catch (error) {
            storeBodyCaptureFailure(error);
          }
        });

        upstreamResponse.on("aborted", async () => {
          if (!response.writableEnded) {
            response.destroy();
          }
          await storeUpstreamResponseFailure("Upstream response aborted.");
        });

        upstreamResponse.on("error", async (error) => {
          if (!response.writableEnded) {
            response.destroy();
          }
          await storeUpstreamResponseFailure(`Upstream response error: ${toErrorMessage(error)}`);
        });
      },
    );

    upstream.on("error", async (error) => {
      abortRequestForward(error);
      if (!response.headersSent) {
        response.writeHead(504, {
          "content-type": "text/plain; charset=utf-8",
          connection: "close",
        });
        response.end("Upstream request failed.");
      } else {
        response.destroy();
      }
      if (stored) {
        return;
      }
      stored = true;
      if (!shouldCapture) {
        return;
      }
      let requestCaptureFailure = "";
      try {
        const requestResult = await finalizeRequestCaptureAfterRequestLifecycle();
        requestBodyPath = requestResult.bodyPath;
        requestBodyPreview = requestResult.preview;
      } catch (captureError) {
        requestCaptureFailure = `; capture finalize failed: ${toErrorMessage(captureError)}`;
      }
      storeSession(repository, bus, {
        ...pending,
        requestBodyPath,
        requestBodyPreview,
        durationMs: Date.now() - startedAt,
        errorCode: "PROXY_TO_SERVER_REQUEST_ERROR",
        errorMessage: `${error.message}${requestCaptureFailure}`,
      });
    });

    let requestForwardError: Error | null = null;
    let requestForwardPromise: Promise<void> = Promise.resolve();
    const toForwardError = (error: unknown) =>
      error instanceof Error ? error : new Error(String(error));
    const abortRequestForward = (error: unknown) => {
      if (requestForwardError) {
        return;
      }
      requestForwardError = toForwardError(error);
      upstream.destroy(requestForwardError);
      if (!request.destroyed && !request.readableEnded) {
        request.pause();
      }
    };

    const waitForUpstreamDrain = () =>
      new Promise<void>((resolve, reject) => {
        const onDrain = () => {
          cleanup();
          resolve();
        };
        const onClose = () => {
          cleanup();
          reject(new Error("Upstream socket closed before drain."));
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const cleanup = () => {
          upstream.off("drain", onDrain);
          upstream.off("close", onClose);
          upstream.off("error", onError);
        };

        upstream.once("drain", onDrain);
        upstream.once("close", onClose);
        upstream.once("error", onError);
      });

    request.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      request.pause();
      requestForwardPromise = requestForwardPromise.then(async () => {
        if (requestCapture) {
          await requestCapture.write(buffer);
        }
        if (!upstream.write(buffer)) {
          await waitForUpstreamDrain();
        }
      });
      requestForwardPromise = requestForwardPromise
        .then(() => {
          if (!requestForwardError && !request.destroyed && !request.readableEnded) {
            request.resume();
          }
        })
        .catch((error) => {
          abortRequestForward(error);
          throw error;
        });
      void requestForwardPromise.catch(() => {});
    });

    request.on("end", async () => {
      try {
        await requestForwardPromise;
      } catch {}
      if (!upstream.destroyed && !requestForwardError) {
        upstream.end();
      }
      try {
        await finalizeRequestCapture();
      } catch {}
      markRequestLifecycleDone();
    });

    request.on("aborted", () => {
      upstream.destroy();
      void requestForwardPromise
        .catch(() => {})
        .then(async () => {
          try {
            await finalizeRequestCapture();
          } catch {}
        })
        .finally(() => {
          markRequestLifecycleDone();
        });
    });

    request.on("error", () => {
      upstream.destroy();
      void requestForwardPromise
        .catch(() => {})
        .then(async () => {
          try {
            await finalizeRequestCapture();
          } catch {}
        })
        .finally(() => {
          markRequestLifecycleDone();
        });
    });

    request.on("close", () => {
      if (requestLifecycleMarkedDone) {
        return;
      }
      void requestForwardPromise
        .catch(() => {})
        .then(async () => {
          try {
            await finalizeRequestCapture();
          } catch {}
        })
        .finally(() => {
          markRequestLifecycleDone();
        });
    });
  });

  server.on("connection", (socket) => {
    trackSocket(activeSockets, socket);
  });

  server.on("connect", (request, clientSocket, head) => {
    const startedAt = Date.now();
    const target = parseTargetHostPort(request.url, 443);

    if (target.port === activeProxyPort && selfHosts.has(target.host)) {
      console.error({
        event: "PROXY_SELF_TARGET_BLOCKED",
        clientIp: request.socket.remoteAddress ?? "",
        method: request.method ?? "CONNECT",
        hostHeader: request.headers.host?.toString() ?? "",
        requestUrl: request.url ?? "",
        targetHost: target.host,
        targetPort: target.port,
        userAgent: request.headers["user-agent"]?.toString() ?? "",
        proxyHost: activeProxyHost,
        proxyPort: activeProxyPort,
      });
      clientSocket.write(
        "HTTP/1.1 508 Loop Detected\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\nBlocked proxy loop: request target resolves to the proxy itself.",
      );
      clientSocket.end();
      return;
    }

    const pending = createPendingSession({
      startedAt: new Date(startedAt).toISOString(),
      scheme: "https",
      method: request.method ?? "CONNECT",
      host: request.url?.trim() || (target.host ? `${target.host}:${target.port}` : "unknown"),
      path: "",
      query: "",
      requestHeaders: request.headers,
    });
    const shouldCaptureConnect = !isNoiseConnectHost(target.host);

    const upstreamSocket = net.connect(target.port, target.host || "localhost");
    trackSocket(activeTunnelSockets, upstreamSocket);
    let stored = false;
    let tunnelEstablished = false;

    const storeConnectError = (errorCode: string, errorMessage: string) => {
      if (stored) {
        return;
      }
      stored = true;
      if (!shouldCaptureConnect) {
        return;
      }
      storeSession(repository, bus, {
        ...pending,
        durationMs: Date.now() - startedAt,
        errorCode,
        errorMessage,
      });
    };

    upstreamSocket.on("connect", () => {
      tunnelEstablished = true;
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) {
        upstreamSocket.write(head);
      }
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);
      if (stored) {
        return;
      }
      stored = true;
      if (!shouldCaptureConnect) {
        return;
      }
      storeSession(repository, bus, {
        ...pending,
        responseStatus: 200,
        durationMs: Date.now() - startedAt,
      });
    });

    upstreamSocket.on("error", (error) => {
      if (tunnelEstablished) {
        clientSocket.destroy();
      } else if (!clientSocket.destroyed) {
        clientSocket.write(
          "HTTP/1.1 504 Gateway Timeout\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\nUpstream connect failed.",
        );
        clientSocket.end();
      }
      storeConnectError("PROXY_TO_SERVER_REQUEST_ERROR", error.message);
    });

    const destroyUpstreamSocket = () => {
      upstreamSocket.destroy();
    };

    clientSocket.on("error", destroyUpstreamSocket);
    clientSocket.on("end", destroyUpstreamSocket);
    clientSocket.on("close", destroyUpstreamSocket);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };

    server.once("error", onError);
    server.listen({ port, host }, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  const resolvedHost =
    address && typeof address !== "string"
      ? (address as AddressInfo).address
      : host;
  const resolvedPort =
    address && typeof address !== "string" ? (address as AddressInfo).port : port;
  activeProxyHost = resolvedHost;
  activeProxyPort = resolvedPort;
  selfHosts.add(normalizeHost(resolvedHost));

  return {
    host: resolvedHost,
    port: resolvedPort,
    close: async () => {
      const forceCloseOpenSockets = () => {
        for (const socket of activeTunnelSockets) {
          socket.destroy();
        }
        for (const socket of activeSockets) {
          socket.destroy();
        }
      };

      await new Promise<void>((resolve, reject) => {
        for (const socket of activeTunnelSockets) {
          socket.end();
        }
        for (const socket of activeSockets) {
          socket.end();
        }

        const forceCloseTimer = setTimeout(forceCloseOpenSockets, 1000);
        forceCloseTimer.unref?.();

        server.close((error) => {
          clearTimeout(forceCloseTimer);
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
