import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { NewSessionRecord, SessionRecord } from "../sessions/types.js";

function parseScheme(value: unknown): "http" | "https" {
  if (value === "http" || value === "https") {
    return value;
  }

  throw new Error(`Invalid session scheme: ${String(value)}`);
}

function mapRow(row: Record<string, unknown>): SessionRecord {
  const nullableText = (value: unknown) =>
    value === null || value === undefined ? null : String(value);

  return {
    id: String(row.id),
    startedAt: String(row.started_at),
    method: String(row.method),
    scheme: parseScheme(row.scheme),
    host: String(row.host),
    path: String(row.path),
    query: String(row.query),
    requestHeaders: JSON.parse(String(row.request_headers)),
    requestBodyPath: nullableText(row.request_body_path),
    requestBodyPreview: nullableText(row.request_body_preview),
    responseStatus: typeof row.response_status === "number" ? Number(row.response_status) : null,
    responseHeaders: JSON.parse(String(row.response_headers)),
    responseBodyPath: nullableText(row.response_body_path),
    responseBodyPreview: nullableText(row.response_body_preview),
    durationMs: typeof row.duration_ms === "number" ? Number(row.duration_ms) : null,
    errorCode: nullableText(row.error_code),
    errorMessage: nullableText(row.error_message),
  };
}

export function createSessionRepository(db: Database.Database) {
  const insert = db.prepare(`
    insert into sessions (
      id, started_at, method, scheme, host, path, query, request_headers,
      request_body_path, request_body_preview, response_status, response_headers,
      response_body_path, response_body_preview, duration_ms, error_code, error_message
    ) values (
      @id, @startedAt, @method, @scheme, @host, @path, @query, @requestHeaders,
      @requestBodyPath, @requestBodyPreview, @responseStatus, @responseHeaders,
      @responseBodyPath, @responseBodyPreview, @durationMs, @errorCode, @errorMessage
    )
  `);

  return {
    insertSession(input: NewSessionRecord) {
      const id = randomUUID();
      insert.run({
        ...input,
        id,
        requestHeaders: JSON.stringify(input.requestHeaders),
        responseHeaders: JSON.stringify(input.responseHeaders),
      });
      return id;
    },
    listSessions() {
      return db
        .prepare("select * from sessions order by started_at desc")
        .all()
        .map((row) => mapRow(row as Record<string, unknown>));
    },
    getSession(id: string) {
      const row = db.prepare("select * from sessions where id = ?").get(id);
      return row ? mapRow(row as Record<string, unknown>) : null;
    },
  };
}
