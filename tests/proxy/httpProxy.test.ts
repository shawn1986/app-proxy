import http from "node:http";
import net from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProxyAgent, fetch } from "undici";
import { openDatabase } from "../../src/storage/db.js";
import { createSessionRepository } from "../../src/storage/sessionRepository.js";
import { createSessionEventBus } from "../../src/realtime/sessionEventBus.js";
import { startProxyServer } from "../../src/proxy/createProxyServer.js";

const RESPONSE_PREVIEW_LIMIT = 4096;

async function getUnusedPort() {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForSession(
  repository: ReturnType<typeof createSessionRepository>,
  timeoutMs = 3000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = repository.listSessions()[0];
    if (session) {
      return session;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out waiting for captured session");
}

describe("HTTP proxy capture", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("captures an HTTP request and response", async () => {
    const upstream = http.createServer((_, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, resolve));
    cleanups.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

    const dir = mkdtempSync(join(tmpdir(), "proxy-http-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const db = openDatabase(join(dir, "sessions.db"));
    cleanups.push(() => {
      db.close();
    });
    const repository = createSessionRepository(db);
    const bus = createSessionEventBus();
    const proxy = await startProxyServer({
      port: 0,
      repository,
      bus,
      certificateDir: join(dir, "certs"),
      bodyDir: join(dir, "bodies"),
    });
    cleanups.push(() => proxy.close());

    const upstreamPort = (upstream.address() as { port: number }).port;
    const proxyAgent = new ProxyAgent(`http://127.0.0.1:${proxy.port}`);
    const requestBody = JSON.stringify({ hello: "proxy" });
    const response = await fetch(`http://127.0.0.1:${upstreamPort}/hello`, {
      method: "POST",
      body: requestBody,
      headers: {
        "content-type": "application/json",
      },
      dispatcher: proxyAgent,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const sessions = repository.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.scheme).toBe("http");
    expect(sessions[0]?.path).toBe("/hello");
    expect(sessions[0]?.responseStatus).toBe(200);
    expect(sessions[0]?.requestBodyPath).toBeTruthy();
    expect(sessions[0]?.responseBodyPath).toBeTruthy();
    expect(existsSync(sessions[0]!.requestBodyPath!)).toBe(true);
    expect(existsSync(sessions[0]!.responseBodyPath!)).toBe(true);
    expect(readFileSync(sessions[0]!.requestBodyPath!, "utf8")).toBe(requestBody);
    expect(readFileSync(sessions[0]!.responseBodyPath!, "utf8")).toBe("{\"ok\":true}");
  });

  it("captures upstream request failures with error details", async () => {
    const dir = mkdtempSync(join(tmpdir(), "proxy-http-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const db = openDatabase(join(dir, "sessions.db"));
    cleanups.push(() => {
      db.close();
    });
    const repository = createSessionRepository(db);
    const bus = createSessionEventBus();
    const proxy = await startProxyServer({
      port: 0,
      repository,
      bus,
      certificateDir: join(dir, "certs"),
      bodyDir: join(dir, "bodies"),
    });
    cleanups.push(() => proxy.close());

    const upstreamPort = await getUnusedPort();
    const proxyAgent = new ProxyAgent(`http://127.0.0.1:${proxy.port}`);
    const response = await fetch(`http://127.0.0.1:${upstreamPort}/fail`, {
      dispatcher: proxyAgent,
    });

    expect(response.status).toBe(504);

    const sessions = repository.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.path).toBe("/fail");
    expect(sessions[0]?.errorCode).toBe("PROXY_TO_SERVER_REQUEST_ERROR");
    expect(sessions[0]?.errorMessage).toContain("ECONNREFUSED");
    expect(sessions[0]?.responseStatus).toBeNull();
  });

  it("does not let subscriber failures break proxy traffic", async () => {
    const upstream = http.createServer((_, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, resolve));
    cleanups.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

    const dir = mkdtempSync(join(tmpdir(), "proxy-http-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const db = openDatabase(join(dir, "sessions.db"));
    cleanups.push(() => {
      db.close();
    });
    const repository = createSessionRepository(db);
    const bus = createSessionEventBus();
    const unsubscribe = bus.subscribe(() => {
      throw new Error("subscriber failed");
    });
    cleanups.push(() => {
      unsubscribe();
    });
    const proxy = await startProxyServer({
      port: 0,
      repository,
      bus,
      certificateDir: join(dir, "certs"),
      bodyDir: join(dir, "bodies"),
    });
    cleanups.push(() => proxy.close());

    const upstreamPort = (upstream.address() as { port: number }).port;
    const proxyAgent = new ProxyAgent(`http://127.0.0.1:${proxy.port}`);
    const response = await fetch(`http://127.0.0.1:${upstreamPort}/safe`, {
      dispatcher: proxyAgent,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(repository.listSessions()).toHaveLength(1);
  });

  it("binds to a configured host so LAN clients can reach the proxy", async () => {
    const upstream = http.createServer((_, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, resolve));
    cleanups.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

    const dir = mkdtempSync(join(tmpdir(), "proxy-http-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const db = openDatabase(join(dir, "sessions.db"));
    cleanups.push(() => {
      db.close();
    });
    const repository = createSessionRepository(db);
    const bus = createSessionEventBus();
    const proxy = await startProxyServer({
      port: 0,
      host: "0.0.0.0",
      repository,
      bus,
      certificateDir: join(dir, "certs"),
      bodyDir: join(dir, "bodies"),
    });
    cleanups.push(() => proxy.close());

    const upstreamPort = (upstream.address() as { port: number }).port;
    const proxyAgent = new ProxyAgent(`http://127.0.0.1:${proxy.port}`);
    const response = await fetch(`http://127.0.0.1:${upstreamPort}/lan`, {
      dispatcher: proxyAgent,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(proxy.host).toBe("0.0.0.0");
    expect(repository.listSessions()[0]?.path).toBe("/lan");
  });

  it("caps response body previews to a fixed size", async () => {
    const body = "a".repeat(RESPONSE_PREVIEW_LIMIT * 2);
    const upstream = http.createServer((_, res) => {
      res.setHeader("content-type", "text/plain");
      res.end(body);
    });
    await new Promise<void>((resolve) => upstream.listen(0, resolve));
    cleanups.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

    const dir = mkdtempSync(join(tmpdir(), "proxy-http-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const db = openDatabase(join(dir, "sessions.db"));
    cleanups.push(() => {
      db.close();
    });
    const repository = createSessionRepository(db);
    const bus = createSessionEventBus();
    const proxy = await startProxyServer({
      port: 0,
      repository,
      bus,
      certificateDir: join(dir, "certs"),
      bodyDir: join(dir, "bodies"),
    });
    cleanups.push(() => proxy.close());

    const upstreamPort = (upstream.address() as { port: number }).port;
    const proxyAgent = new ProxyAgent(`http://127.0.0.1:${proxy.port}`);
    const response = await fetch(`http://127.0.0.1:${upstreamPort}/large`, {
      dispatcher: proxyAgent,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);

    const session = repository.listSessions()[0];
    expect(session?.responseBodyPreview).toHaveLength(RESPONSE_PREVIEW_LIMIT);
    expect(session?.responseBodyPreview).toBe(body.slice(0, RESPONSE_PREVIEW_LIMIT));
    expect(session?.responseBodyPath).toBeTruthy();
    expect(existsSync(session!.responseBodyPath!)).toBe(true);
    expect(readFileSync(session!.responseBodyPath!, "utf8")).toBe(body);
  });

  it("blocks self-target requests and does not persist sessions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "proxy-http-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const db = openDatabase(join(dir, "sessions.db"));
    cleanups.push(() => {
      db.close();
    });
    const repository = createSessionRepository(db);
    const bus = createSessionEventBus();
    const proxy = await startProxyServer({
      port: 0,
      host: "127.0.0.1",
      repository,
      bus,
      certificateDir: join(dir, "certs"),
      bodyDir: join(dir, "bodies"),
    });
    cleanups.push(() => proxy.close());

    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    cleanups.push(() => stderr.mockRestore());

    const proxyAgent = new ProxyAgent(`http://127.0.0.1:${proxy.port}`);
    const response = await fetch(`http://127.0.0.1:${proxy.port}/loop`, {
      dispatcher: proxyAgent,
      headers: {
        "user-agent": "self-target-test",
      },
    });

    expect(response.status).toBe(508);
    expect(await response.text()).toContain("proxy loop");
    expect(repository.listSessions()).toHaveLength(0);
    expect(stderr).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "PROXY_SELF_TARGET_BLOCKED",
        method: "GET",
        targetHost: "127.0.0.1",
        targetPort: proxy.port,
        userAgent: "self-target-test",
        proxyPort: proxy.port,
      }),
    );
  });

  it("waits for request completion before finalizing tunnel request capture", async () => {
    const upstream = http.createServer((request, res) => {
      request.once("data", () => {
        res.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
        res.end("too large");
      });
      request.resume();
    });
    await new Promise<void>((resolve) => upstream.listen(0, resolve));
    cleanups.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

    const dir = mkdtempSync(join(tmpdir(), "proxy-http-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const db = openDatabase(join(dir, "sessions.db"));
    cleanups.push(() => {
      db.close();
    });
    const repository = createSessionRepository(db);
    const bus = createSessionEventBus();
    const proxy = await startProxyServer({
      port: 0,
      repository,
      bus,
      certificateDir: join(dir, "certs"),
      bodyDir: join(dir, "bodies"),
    });
    cleanups.push(() => proxy.close());

    const upstreamPort = (upstream.address() as { port: number }).port;
    const requestBody = "a".repeat(2048) + "b".repeat(2048);
    const firstChunk = requestBody.slice(0, 1024);
    const remainingChunk = requestBody.slice(1024);

    const socket = net.connect(proxy.port, "127.0.0.1");
    cleanups.push(() => {
      socket.destroy();
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });

    const responseChunks: Buffer[] = [];
    let resolveFirstResponse: (() => void) | null = null;
    const firstResponsePromise = new Promise<void>((resolve) => {
      resolveFirstResponse = resolve;
    });
    const responseDonePromise = new Promise<void>((resolve, reject) => {
      socket.on("data", (chunk) => {
        responseChunks.push(Buffer.from(chunk));
        if (resolveFirstResponse) {
          resolveFirstResponse();
          resolveFirstResponse = null;
        }
      });
      socket.once("end", () => resolve());
      socket.once("error", reject);
    });

    socket.write(
      `POST http://127.0.0.1:${upstreamPort}/early-response HTTP/1.1\r\nHost: 127.0.0.1:${upstreamPort}\r\nContent-Type: text/plain\r\nContent-Length: ${requestBody.length}\r\nConnection: keep-alive\r\n\r\n`,
    );
    socket.write(firstChunk);

    const sawEarlyResponse = await Promise.race([
      firstResponsePromise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 1000)),
    ]);
    expect(sawEarlyResponse).toBe(true);

    socket.write(remainingChunk);
    socket.end();
    await responseDonePromise;

    const rawResponse = Buffer.concat(responseChunks).toString("utf8");
    expect(rawResponse).toContain("413");

    const session = await waitForSession(repository);
    expect(session.path).toBe("/early-response");
    expect(session.responseStatus).toBe(413);
    expect(session.requestBodyPath).toBeTruthy();
    expect(readFileSync(session.requestBodyPath!, "utf8")).toBe(requestBody);
  });
});
