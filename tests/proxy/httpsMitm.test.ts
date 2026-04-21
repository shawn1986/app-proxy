import https from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import selfsigned from "selfsigned";
import { HttpsProxyAgent } from "https-proxy-agent";
import { openDatabase } from "../../src/storage/db.js";
import { createSessionRepository } from "../../src/storage/sessionRepository.js";
import { createSessionEventBus } from "../../src/realtime/sessionEventBus.js";
import { startProxyServer } from "../../src/proxy/createProxyServer.js";

describe("HTTPS MITM capture", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("captures HTTPS traffic when the client trusts the local CA", async () => {
    const dir = mkdtempSync(join(tmpdir(), "proxy-https-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const upstreamCert = await selfsigned.generate(
      [{ name: "commonName", value: "localhost" }],
      {
        algorithm: "sha256",
        extensions: [
          {
            name: "subjectAltName",
            altNames: [
              { type: 2, value: "localhost" },
              { type: 7, ip: "127.0.0.1" },
            ],
          },
        ],
      },
    );
    const upstream = https.createServer(
      { key: upstreamCert.private, cert: upstreamCert.cert },
      (_, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ secure: true }));
      },
    );
    await new Promise<void>((resolve) => upstream.listen(0, resolve));
    cleanups.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

    const db = openDatabase(join(dir, "sessions.db"));
    cleanups.push(() => {
      db.close();
    });
    const repository = createSessionRepository(db);
    const bus = createSessionEventBus();
    const proxy = await startProxyServer({
      port: 0,
      httpsMode: "mitm",
      repository,
      bus,
      certificateDir: join(dir, "certs"),
      bodyDir: join(dir, "bodies"),
      upstreamCaCertificates: [upstreamCert.cert],
    });
    cleanups.push(() => proxy.close());

    const caPath = join(dir, "certs", "ca.pem");
    const upstreamPort = (upstream.address() as { port: number }).port;
    const agent = new HttpsProxyAgent(`http://127.0.0.1:${proxy.port}`);

    const body = await new Promise<string>((resolve, reject) => {
      const request = https.get(
        `https://localhost:${upstreamPort}/secure`,
        {
          agent,
          ca: readFileSync(caPath),
          rejectUnauthorized: true,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        },
      );
      request.on("error", reject);
    });

    expect(body).toContain("\"secure\":true");

    const sessions = repository.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.scheme).toBe("https");
    expect(sessions[0]?.path).toBe("/secure");
  });

  it("keeps upstream TLS verification enabled by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "proxy-https-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const upstreamCert = await selfsigned.generate(
      [{ name: "commonName", value: "localhost" }],
      {
        algorithm: "sha256",
        extensions: [
          {
            name: "subjectAltName",
            altNames: [
              { type: 2, value: "localhost" },
              { type: 7, ip: "127.0.0.1" },
            ],
          },
        ],
      },
    );
    const upstream = https.createServer(
      { key: upstreamCert.private, cert: upstreamCert.cert },
      (_, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ secure: true }));
      },
    );
    await new Promise<void>((resolve) => upstream.listen(0, resolve));
    cleanups.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

    const db = openDatabase(join(dir, "sessions.db"));
    cleanups.push(() => {
      db.close();
    });
    const repository = createSessionRepository(db);
    const bus = createSessionEventBus();
    const proxy = await startProxyServer({
      port: 0,
      httpsMode: "mitm",
      repository,
      bus,
      certificateDir: join(dir, "certs"),
      bodyDir: join(dir, "bodies"),
    });
    cleanups.push(() => proxy.close());

    const caPath = join(dir, "certs", "ca.pem");
    const upstreamPort = (upstream.address() as { port: number }).port;
    const agent = new HttpsProxyAgent(`http://127.0.0.1:${proxy.port}`);

    const body = await new Promise<string>((resolve, reject) => {
      const request = https.get(
        `https://localhost:${upstreamPort}/secure`,
        {
          agent,
          ca: readFileSync(caPath),
          rejectUnauthorized: true,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        },
      );
      request.on("error", reject);
    });

    expect(body).toContain("PROXY_TO_SERVER_REQUEST_ERROR");

    const sessions = repository.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.errorCode).toBe("PROXY_TO_SERVER_REQUEST_ERROR");
    expect(sessions[0]?.responseStatus).toBeNull();
  });
});
