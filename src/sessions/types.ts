export type SessionRecord = {
  id: string;
  startedAt: string;
  method: string;
  scheme: "http" | "https";
  host: string;
  path: string;
  query: string;
  requestHeaders: Record<string, string>;
  requestBodyPath: string | null;
  requestBodyPreview: string | null;
  responseStatus: number | null;
  responseHeaders: Record<string, string>;
  responseBodyPath: string | null;
  responseBodyPreview: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type NewSessionRecord = Omit<SessionRecord, "id">;
