import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/storage/db.js";
import { createSessionRepository } from "../../src/storage/sessionRepository.js";

describe("session repository", () => {
  const dirs: string[] = [];
  const databases: Database.Database[] = [];

  afterEach(() => {
    for (const db of databases) {
      db.close();
    }

    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }

    databases.length = 0;
    dirs.length = 0;
  });

  it("stores and returns captured sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "proxy-db-"));
    dirs.push(dir);

    const db = openDatabase(join(dir, "sessions.db"));
    databases.push(db);
    const repository = createSessionRepository(db);

    const id = repository.insertSession({
      startedAt: "2026-04-20T10:00:00.000Z",
      method: "GET",
      scheme: "https",
      host: "api.example.test",
      path: "/v1/me",
      query: "",
      requestHeaders: { accept: "application/json" },
      requestBodyPath: null,
      requestBodyPreview: null,
      responseStatus: 200,
      responseHeaders: { "content-type": "application/json" },
      responseBodyPath: null,
      responseBodyPreview: "{\"ok\":true}",
      durationMs: 42,
      errorCode: null,
      errorMessage: null
    });

    const list = repository.listSessions();
    const detail = repository.getSession(id);

    expect(list).toHaveLength(1);
    expect(list[0]?.host).toBe("api.example.test");
    expect(detail?.responseStatus).toBe(200);
    expect(detail?.responseBodyPreview).toContain("\"ok\":true");
  });

  it("preserves empty-string nullable text fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "proxy-db-"));
    dirs.push(dir);

    const db = openDatabase(join(dir, "sessions.db"));
    databases.push(db);
    const repository = createSessionRepository(db);

    const id = repository.insertSession({
      startedAt: "2026-04-20T10:05:00.000Z",
      method: "POST",
      scheme: "https",
      host: "api.example.test",
      path: "/v1/submit",
      query: "",
      requestHeaders: { "content-type": "application/json" },
      requestBodyPath: "",
      requestBodyPreview: "",
      responseStatus: 500,
      responseHeaders: { "content-type": "application/json" },
      responseBodyPath: "",
      responseBodyPreview: "",
      durationMs: 84,
      errorCode: "",
      errorMessage: ""
    });

    const detail = repository.getSession(id);

    expect(detail?.requestBodyPath).toBe("");
    expect(detail?.requestBodyPreview).toBe("");
    expect(detail?.responseBodyPath).toBe("");
    expect(detail?.responseBodyPreview).toBe("");
    expect(detail?.errorCode).toBe("");
    expect(detail?.errorMessage).toBe("");
  });

  it("rejects rows with an invalid scheme", () => {
    const dir = mkdtempSync(join(tmpdir(), "proxy-db-"));
    dirs.push(dir);
    const filePath = join(dir, "sessions.db");

    const legacyDb = new BetterSqlite3(filePath);
    databases.push(legacyDb);
    legacyDb.exec(`
      create table sessions (
        id text primary key,
        started_at text not null,
        method text not null,
        scheme text not null,
        host text not null,
        path text not null,
        query text not null,
        request_headers text not null,
        request_body_path text,
        request_body_preview text,
        response_status integer,
        response_headers text not null,
        response_body_path text,
        response_body_preview text,
        duration_ms integer,
        error_code text,
        error_message text
      );
    `);

    legacyDb.prepare(`
      insert into sessions (
        id, started_at, method, scheme, host, path, query, request_headers,
        request_body_path, request_body_preview, response_status, response_headers,
        response_body_path, response_body_preview, duration_ms, error_code, error_message
      ) values (
        @id, @startedAt, @method, @scheme, @host, @path, @query, @requestHeaders,
        @requestBodyPath, @requestBodyPreview, @responseStatus, @responseHeaders,
        @responseBodyPath, @responseBodyPreview, @durationMs, @errorCode, @errorMessage
      )
    `).run({
      id: "bad-scheme",
      startedAt: "2026-04-20T10:10:00.000Z",
      method: "GET",
      scheme: "ftp",
      host: "api.example.test",
      path: "/v1/me",
      query: "",
      requestHeaders: JSON.stringify({ accept: "application/json" }),
      requestBodyPath: null,
      requestBodyPreview: null,
      responseStatus: 200,
      responseHeaders: JSON.stringify({ "content-type": "application/json" }),
      responseBodyPath: null,
      responseBodyPreview: null,
      durationMs: 10,
      errorCode: null,
      errorMessage: null
    });
    legacyDb.close();
    databases.pop();

    const db = openDatabase(filePath);
    databases.push(db);
    const repository = createSessionRepository(db);

    expect(() => repository.getSession("bad-scheme")).toThrow(
      "Invalid session scheme: ftp",
    );
  });
});
