import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server.js";
import { openDatabase } from "../../src/storage/db.js";
import { createSessionRepository } from "../../src/storage/sessionRepository.js";

describe("session and setup routes", () => {
  const dataDirs: string[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    while (apps.length > 0) {
      await apps.pop()?.close();
    }
    for (const dir of dataDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns setup state, certificate state, and session routes", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "proxy-routes-"));
    dataDirs.push(dataDir);

    const app = await buildApp({ dataDir });
    apps.push(app);
    const db = openDatabase(join(dataDir, "sessions.db"));
    const repository = createSessionRepository(db);
    const sessionId = repository.insertSession({
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
      errorMessage: null,
    });
    db.close();

    const setup = await app.inject({ method: "GET", url: "/api/setup" });
    const sessions = await app.inject({ method: "GET", url: "/api/sessions" });
    const detail = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}` });
    const certificate = await app.inject({ method: "GET", url: "/api/certificate" });

    expect(setup.statusCode).toBe(200);
    expect(setup.json()).toMatchObject({
      proxyPort: 18080,
      certificate: {
        exists: false,
      },
    });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json()).toHaveLength(1);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: sessionId,
      host: "api.example.test",
      path: "/v1/me",
      responseStatus: 200,
    });
    expect(certificate.statusCode).toBe(404);
    expect(certificate.json()).toEqual({
      message: "CA certificate has not been generated yet",
    });
  });

  it("serves the dashboard shell", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "proxy-ui-"));
    dataDirs.push(dataDir);

    const app = await buildApp({ dataDir });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Android 代理監控台");
    expect(response.body).toContain("流量事件");
    expect(response.body).toContain("封包剖析");
    expect(response.body).toContain("節點診斷");
    expect(response.body).toContain('id="live-status"');
    expect(response.body).toContain('id="session-count-chip"');
  });

  it("exposes the SSE endpoint", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "proxy-events-"));
    dataDirs.push(dataDir);

    const app = await buildApp({ dataDir });
    apps.push(app);

    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${address}/api/events`, {
      headers: {
        accept: "text/event-stream",
      },
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    const firstChunk = await reader?.read();
    controller.abort();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(Buffer.from(firstChunk?.value ?? []).toString("utf8")).toContain(": connected");
  });
});
