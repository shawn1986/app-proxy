import type { IncomingHttpHeaders } from "node:http";
import type { NewSessionRecord } from "../sessions/types.js";

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(", ") : String(value ?? ""),
    ]),
  );
}

export function createPendingSession(input: {
  startedAt: string;
  scheme: "http" | "https";
  method: string;
  host: string;
  path: string;
  query: string;
  requestHeaders: IncomingHttpHeaders;
}): NewSessionRecord {
  return {
    startedAt: input.startedAt,
    scheme: input.scheme,
    method: input.method,
    host: input.host,
    path: input.path,
    query: input.query,
    requestHeaders: normalizeHeaders(input.requestHeaders),
    requestBodyPath: null,
    requestBodyPreview: null,
    responseStatus: null,
    responseHeaders: {},
    responseBodyPath: null,
    responseBodyPreview: null,
    durationMs: null,
    errorCode: null,
    errorMessage: null,
  };
}

export function finalizePendingSession(
  pending: NewSessionRecord,
  response: {
    requestBodyPath: string | null;
    requestBodyPreview: string | null;
    status: number;
    headers: IncomingHttpHeaders;
    responseBodyPath: string | null;
    durationMs: number;
    responseBodyPreview: string | null;
  },
): NewSessionRecord {
  return {
    ...pending,
    requestBodyPath: response.requestBodyPath,
    requestBodyPreview: response.requestBodyPreview,
    responseStatus: response.status,
    responseHeaders: normalizeHeaders(response.headers),
    responseBodyPath: response.responseBodyPath,
    responseBodyPreview: response.responseBodyPreview,
    durationMs: response.durationMs,
  };
}
