# Android Proxy Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Node.js app that captures Android HTTP/HTTPS traffic through an explicit proxy, decrypts HTTPS with a local CA, stores sessions, and shows them in a browser dashboard.

**Architecture:** A single Fastify process hosts the proxy listener, REST API, SSE stream, and static dashboard assets. The proxy core emits normalized session events into a SQLite-backed repository; the web UI consumes the repository over JSON and live session updates over SSE.

**Tech Stack:** Node.js, TypeScript, Fastify, `http-mitm-proxy`, SQLite via `better-sqlite3`, Vitest, static HTML/CSS/JS

---

## File Structure

Create these files and keep the responsibilities narrow:

- `package.json` - npm scripts and dependency declarations.
- `tsconfig.json` - TypeScript compiler settings.
- `vitest.config.ts` - test runner config.
- `.gitignore` - ignore build output, SQLite files, and local CA material.
- `README.md` - local run instructions and Android setup summary.
- `src/server.ts` - Fastify app bootstrap, route registration, static asset serving, SSE wiring.
- `src/config.ts` - central runtime paths and ports.
- `src/sessions/types.ts` - session and diagnostics type definitions.
- `src/storage/db.ts` - SQLite connection and schema bootstrap.
- `src/storage/bodyStore.ts` - body file persistence and stable file naming.
- `src/storage/sessionRepository.ts` - insert/list/get operations for sessions.
- `src/realtime/sessionEventBus.ts` - publish/subscribe bridge for live session updates.
- `src/bodies/decodeBody.ts` - decompress, classify, and truncate request/response bodies.
- `src/ca/caStore.ts` - CA directory management and certificate metadata lookup.
- `src/proxy/createProxyServer.ts` - proxy server lifecycle and MITM hooks.
- `src/proxy/sessionCollector.ts` - turn proxy callbacks into normalized session records.
- `src/http/routes/healthRoutes.ts` - `/health` endpoint.
- `src/http/routes/sessionRoutes.ts` - `/api/sessions` and `/api/sessions/:id`.
- `src/http/routes/setupRoutes.ts` - `/api/setup` and `/api/certificate`.
- `public/index.html` - dashboard shell with three panes.
- `public/app.js` - fetch list/detail data, bind filters, consume SSE.
- `public/styles.css` - dashboard layout and states.
- `tests/http/health.test.ts` - app boot smoke test.
- `tests/storage/sessionRepository.test.ts` - repository insert/list/get coverage.
- `tests/bodies/decodeBody.test.ts` - decompression and truncation coverage.
- `tests/proxy/httpProxy.test.ts` - explicit HTTP proxy capture flow.
- `tests/proxy/httpsMitm.test.ts` - HTTPS `CONNECT` interception flow.
- `tests/http/routes.test.ts` - setup and session API coverage.

## Task 1: Bootstrap the repo and Fastify skeleton

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/server.ts`
- Create: `src/http/routes/healthRoutes.ts`
- Test: `tests/http/health.test.ts`

- [ ] **Step 1: Initialize git and npm metadata**

Run:

```bash
git init
npm init -y
```

Expected: `.git/` exists and `package.json` is created.

- [ ] **Step 2: Write the failing health test**

Create `tests/http/health.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server";

describe("GET /health", () => {
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    while (apps.length > 0) {
      await apps.pop()?.close();
    }
  });

  it("returns ok", async () => {
    const app = await buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
npm test -- --run tests/http/health.test.ts
```

Expected: FAIL because `src/server.ts` and the Vitest script do not exist yet.

- [ ] **Step 4: Add the minimal app skeleton and toolchain**

Replace `package.json` with:

```json
{
  "name": "android-proxy-dashboard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/static": "^7.0.4",
    "fastify": "^4.28.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
.data/
.certs/
coverage/
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

Create `src/http/routes/healthRoutes.ts`:

```ts
import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));
}
```

Create `src/server.ts`:

```ts
import Fastify from "fastify";
import { registerHealthRoutes } from "./http/routes/healthRoutes.js";

export async function buildApp() {
  const app = Fastify();
  await registerHealthRoutes(app);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildApp();
  await app.listen({ host: "127.0.0.1", port: 3000 });
}
```

Run:

```bash
npm install
```

Expected: dependencies install cleanly.

- [ ] **Step 5: Run the health test to verify it passes**

Run:

```bash
npm test -- --run tests/http/health.test.ts
```

Expected: PASS with one passing test.

- [ ] **Step 6: Commit the bootstrap**

Run:

```bash
git add .gitignore package.json tsconfig.json vitest.config.ts src/server.ts src/http/routes/healthRoutes.ts tests/http/health.test.ts
git commit -m "chore: bootstrap fastify app"
```

## Task 2: Add the session model and SQLite repository

**Files:**
- Create: `src/sessions/types.ts`
- Create: `src/storage/db.ts`
- Create: `src/storage/sessionRepository.ts`
- Test: `tests/storage/sessionRepository.test.ts`

- [ ] **Step 1: Write the failing repository test**

Create `tests/storage/sessionRepository.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/storage/db";
import { createSessionRepository } from "../../src/storage/sessionRepository";

describe("session repository", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stores and returns captured sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "proxy-db-"));
    dirs.push(dir);

    const db = openDatabase(join(dir, "sessions.db"));
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
});
```

- [ ] **Step 2: Run the repository test to verify it fails**

Run:

```bash
npm test -- --run tests/storage/sessionRepository.test.ts
```

Expected: FAIL because the database and repository modules do not exist.

- [ ] **Step 3: Implement the session types, database bootstrap, and repository**

Create `src/sessions/types.ts`:

```ts
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
```

Create `src/storage/db.ts`:

```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export function openDatabase(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.exec(`
    create table if not exists sessions (
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
  return db;
}
```

Create `src/storage/sessionRepository.ts`:

```ts
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { NewSessionRecord, SessionRecord } from "../sessions/types.js";

function mapRow(row: Record<string, unknown>): SessionRecord {
  return {
    id: String(row.id),
    startedAt: String(row.started_at),
    method: String(row.method),
    scheme: row.scheme as "http" | "https",
    host: String(row.host),
    path: String(row.path),
    query: String(row.query),
    requestHeaders: JSON.parse(String(row.request_headers)),
    requestBodyPath: row.request_body_path ? String(row.request_body_path) : null,
    requestBodyPreview: row.request_body_preview ? String(row.request_body_preview) : null,
    responseStatus: typeof row.response_status === "number" ? Number(row.response_status) : null,
    responseHeaders: JSON.parse(String(row.response_headers)),
    responseBodyPath: row.response_body_path ? String(row.response_body_path) : null,
    responseBodyPreview: row.response_body_preview ? String(row.response_body_preview) : null,
    durationMs: typeof row.duration_ms === "number" ? Number(row.duration_ms) : null,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
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
        .prepare(`select * from sessions order by started_at desc`)
        .all()
        .map((row) => mapRow(row as Record<string, unknown>));
    },
    getSession(id: string) {
      const row = db.prepare(`select * from sessions where id = ?`).get(id);
      return row ? mapRow(row as Record<string, unknown>) : null;
    },
  };
}
```

Install the new dependency:

```bash
npm install better-sqlite3
```

- [ ] **Step 4: Run the repository test to verify it passes**

Run:

```bash
npm test -- --run tests/storage/sessionRepository.test.ts
```

Expected: PASS with one passing repository test.

- [ ] **Step 5: Commit the repository layer**

Run:

```bash
git add src/sessions/types.ts src/storage/db.ts src/storage/sessionRepository.ts package.json package-lock.json tests/storage/sessionRepository.test.ts
git commit -m "feat: add session repository"
```

## Task 3: Capture explicit HTTP proxy traffic

**Files:**
- Create: `src/realtime/sessionEventBus.ts`
- Create: `src/proxy/sessionCollector.ts`
- Create: `src/proxy/createProxyServer.ts`
- Test: `tests/proxy/httpProxy.test.ts`

- [ ] **Step 1: Write the failing HTTP proxy integration test**

Create `tests/proxy/httpProxy.test.ts`:

```ts
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProxyAgent, fetch } from "undici";
import { openDatabase } from "../../src/storage/db";
import { createSessionRepository } from "../../src/storage/sessionRepository";
import { createSessionEventBus } from "../../src/realtime/sessionEventBus";
import { startProxyServer } from "../../src/proxy/createProxyServer";

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

    const repository = createSessionRepository(openDatabase(join(dir, "sessions.db")));
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
    const response = await fetch(`http://127.0.0.1:${upstreamPort}/hello`, {
      dispatcher: proxyAgent,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const sessions = repository.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.scheme).toBe("http");
    expect(sessions[0]?.path).toBe("/hello");
    expect(sessions[0]?.responseStatus).toBe(200);
  });
});
```

- [ ] **Step 2: Run the HTTP proxy test to verify it fails**

Run:

```bash
npm test -- --run tests/proxy/httpProxy.test.ts
```

Expected: FAIL because the proxy modules and realtime bus do not exist.

- [ ] **Step 3: Implement the event bus and HTTP capture pipeline**

Create `src/realtime/sessionEventBus.ts`:

```ts
import { EventEmitter } from "node:events";
import type { SessionRecord } from "../sessions/types.js";

export function createSessionEventBus() {
  const emitter = new EventEmitter();

  return {
    publish(session: SessionRecord) {
      emitter.emit("session", session);
    },
    subscribe(handler: (session: SessionRecord) => void) {
      emitter.on("session", handler);
      return () => emitter.off("session", handler);
    },
  };
}
```

Create `src/proxy/sessionCollector.ts`:

```ts
import type { IncomingHttpHeaders } from "node:http";
import type { NewSessionRecord, SessionRecord } from "../sessions/types.js";

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value ?? "")]),
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
    status: number;
    headers: IncomingHttpHeaders;
    durationMs: number;
    responseBodyPreview: string | null;
  },
): NewSessionRecord {
  return {
    ...pending,
    responseStatus: response.status,
    responseHeaders: normalizeHeaders(response.headers),
    responseBodyPreview: response.responseBodyPreview,
    durationMs: response.durationMs,
  };
}
```

Create `src/proxy/createProxyServer.ts`:

```ts
import { mkdirSync } from "node:fs";
import Proxy from "http-mitm-proxy";
import type { createSessionEventBus } from "../realtime/sessionEventBus.js";
import type { createSessionRepository } from "../storage/sessionRepository.js";
import { createPendingSession, finalizePendingSession } from "./sessionCollector.js";

type ProxyDeps = {
  port: number;
  repository: ReturnType<typeof createSessionRepository>;
  bus: ReturnType<typeof createSessionEventBus>;
  certificateDir: string;
  bodyDir: string;
};

export async function startProxyServer({ port, repository, bus, certificateDir }: ProxyDeps) {
  mkdirSync(certificateDir, { recursive: true });
  const proxy = Proxy();

  proxy.onRequest((ctx, callback) => {
    const startedAt = Date.now();
    const url = new URL(ctx.clientToProxyRequest.url ?? "/", `${ctx.isSSL ? "https" : "http"}://${ctx.clientToProxyRequest.headers.host}`);
    const pending = createPendingSession({
      startedAt: new Date(startedAt).toISOString(),
      scheme: ctx.isSSL ? "https" : "http",
      method: ctx.clientToProxyRequest.method ?? "GET",
      host: url.host,
      path: url.pathname,
      query: url.search,
      requestHeaders: ctx.clientToProxyRequest.headers,
    });

    const chunks: Buffer[] = [];
    ctx.onResponseData((_, chunk, done) => {
      chunks.push(Buffer.from(chunk));
      return done(null, chunk);
    });

    ctx.onResponseEnd((_, done) => {
      const completed = finalizePendingSession(pending, {
        status: ctx.serverToProxyResponse.statusCode ?? 0,
        headers: ctx.serverToProxyResponse.headers,
        durationMs: Date.now() - startedAt,
        responseBodyPreview: Buffer.concat(chunks).toString("utf8"),
      });
      const id = repository.insertSession(completed);
      const stored = repository.getSession(id);
      if (stored) {
        bus.publish(stored);
      }
      return done();
    });

    return callback();
  });

  await new Promise<void>((resolve) => {
    proxy.listen({ port, sslCaDir: certificateDir }, resolve);
  });

  const address = proxy.httpAgent.address() as { port: number };

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        proxy.close((error: Error | null) => (error ? reject(error) : resolve()));
      }),
  };
}
```

Install the new runtime and test dependencies:

```bash
npm install http-mitm-proxy undici
```

- [ ] **Step 4: Run the HTTP proxy test to verify it passes**

Run:

```bash
npm test -- --run tests/proxy/httpProxy.test.ts
```

Expected: PASS with one captured session.

- [ ] **Step 5: Commit the HTTP capture pipeline**

Run:

```bash
git add src/realtime/sessionEventBus.ts src/proxy/sessionCollector.ts src/proxy/createProxyServer.ts package.json package-lock.json tests/proxy/httpProxy.test.ts
git commit -m "feat: capture http proxy sessions"
```

## Task 4: Add CA management and HTTPS MITM capture

**Files:**
- Create: `src/config.ts`
- Create: `src/ca/caStore.ts`
- Modify: `src/proxy/createProxyServer.ts`
- Test: `tests/proxy/httpsMitm.test.ts`

- [ ] **Step 1: Write the failing HTTPS interception test**

Create `tests/proxy/httpsMitm.test.ts`:

```ts
import https from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import selfsigned from "selfsigned";
import { HttpsProxyAgent } from "https-proxy-agent";
import { openDatabase } from "../../src/storage/db";
import { createSessionRepository } from "../../src/storage/sessionRepository";
import { createSessionEventBus } from "../../src/realtime/sessionEventBus";
import { startProxyServer } from "../../src/proxy/createProxyServer";

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

    const upstreamCert = selfsigned.generate([{ name: "commonName", value: "localhost" }], { days: 1 });
    const upstream = https.createServer(
      { key: upstreamCert.private, cert: upstreamCert.cert },
      (_, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ secure: true }));
      },
    );
    await new Promise<void>((resolve) => upstream.listen(0, resolve));
    cleanups.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

    const repository = createSessionRepository(openDatabase(join(dir, "sessions.db")));
    const bus = createSessionEventBus();
    const proxy = await startProxyServer({
      port: 0,
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

    expect(body).toContain("\"secure\":true");

    const sessions = repository.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.scheme).toBe("https");
    expect(sessions[0]?.path).toBe("/secure");
  });
});
```

- [ ] **Step 2: Run the HTTPS interception test to verify it fails**

Run:

```bash
npm test -- --run tests/proxy/httpsMitm.test.ts
```

Expected: FAIL because no CA metadata helper exists and the proxy is not yet hardened for HTTPS verification.

- [ ] **Step 3: Add config and CA helpers, then wire HTTPS interception**

Create `src/config.ts`:

```ts
import { join } from "node:path";

export const appConfig = {
  httpPort: Number(process.env.APP_PORT ?? 3000),
  proxyPort: Number(process.env.PROXY_PORT ?? 8080),
  dataDir: process.env.DATA_DIR ?? ".data",
  certificateDir: join(process.env.DATA_DIR ?? ".data", "certs"),
  bodyDir: join(process.env.DATA_DIR ?? ".data", "bodies"),
  databasePath: join(process.env.DATA_DIR ?? ".data", "sessions.db"),
};
```

Create `src/ca/caStore.ts`:

```ts
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type CertificateState = {
  caPath: string;
  exists: boolean;
  createdAt: string | null;
};

export function readCertificateState(certificateDir: string): CertificateState {
  mkdirSync(certificateDir, { recursive: true });
  const caPath = join(certificateDir, "ca.pem");

  if (!existsSync(caPath)) {
    return { caPath, exists: false, createdAt: null };
  }

  return {
    caPath,
    exists: true,
    createdAt: statSync(caPath).mtime.toISOString(),
  };
}
```

Update `src/proxy/createProxyServer.ts` to add error hooks and explicit HTTPS diagnostics:

```ts
  proxy.onError((ctx, error, kind) => {
    const startedAt = new Date().toISOString();
    const url = ctx?.clientToProxyRequest?.url ?? "/";
    const host = ctx?.clientToProxyRequest?.headers.host ?? "unknown";

    repository.insertSession({
      startedAt,
      method: ctx?.clientToProxyRequest?.method ?? "CONNECT",
      scheme: ctx?.isSSL ? "https" : "http",
      host: String(host),
      path: url,
      query: "",
      requestHeaders: {},
      requestBodyPath: null,
      requestBodyPreview: null,
      responseStatus: null,
      responseHeaders: {},
      responseBodyPath: null,
      responseBodyPreview: null,
      durationMs: null,
      errorCode: kind,
      errorMessage: error.message,
    });
  });
```

Update the `listen` call in `src/proxy/createProxyServer.ts` to ensure the CA directory is used for HTTPS MITM:

```ts
  await new Promise<void>((resolve) => {
    proxy.listen(
      {
        port,
        sslCaDir: certificateDir,
        keepAlive: true,
      },
      resolve,
    );
  });
```

Install the HTTPS test dependencies:

```bash
npm install https-proxy-agent selfsigned
```

- [ ] **Step 4: Run the HTTPS interception test to verify it passes**

Run:

```bash
npm test -- --run tests/proxy/httpsMitm.test.ts
```

Expected: PASS with one HTTPS session captured.

- [ ] **Step 5: Commit the HTTPS and CA support**

Run:

```bash
git add src/config.ts src/ca/caStore.ts src/proxy/createProxyServer.ts package.json package-lock.json tests/proxy/httpsMitm.test.ts
git commit -m "feat: add https mitm capture"
```

## Task 5: Add body decoding, body persistence, truncation, and API routes

**Files:**
- Create: `src/bodies/decodeBody.ts`
- Create: `src/storage/bodyStore.ts`
- Create: `src/http/routes/sessionRoutes.ts`
- Create: `src/http/routes/setupRoutes.ts`
- Modify: `src/proxy/sessionCollector.ts`
- Modify: `src/proxy/createProxyServer.ts`
- Modify: `src/server.ts`
- Test: `tests/bodies/decodeBody.test.ts`
- Test: `tests/http/routes.test.ts`

- [ ] **Step 1: Write the failing decode and API tests**

Create `tests/bodies/decodeBody.test.ts`:

```ts
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeBody } from "../../src/bodies/decodeBody";

describe("decodeBody", () => {
  it("inflates gzip and truncates long text", () => {
    const longText = "a".repeat(6000);
    const result = decodeBody({
      payload: gzipSync(Buffer.from(longText)),
      contentEncoding: "gzip",
      contentType: "text/plain; charset=utf-8",
      maxPreviewBytes: 4096,
    });

    expect(result.preview.length).toBe(4096);
    expect(result.truncated).toBe(true);
    expect(result.preview.startsWith("aaaa")).toBe(true);
  });
});
```

Create `tests/http/routes.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server";

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

  it("returns setup state and an empty session list", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "proxy-routes-"));
    dataDirs.push(dataDir);

    const app = await buildApp({ dataDir });
    apps.push(app);

    const setup = await app.inject({ method: "GET", url: "/api/setup" });
    const sessions = await app.inject({ method: "GET", url: "/api/sessions" });

    expect(setup.statusCode).toBe(200);
    expect(setup.json()).toMatchObject({
      proxyPort: 8080,
      certificate: {
        exists: false,
      },
    });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the decode and API tests to verify they fail**

Run:

```bash
npm test -- --run tests/bodies/decodeBody.test.ts tests/http/routes.test.ts
```

Expected: FAIL because the decode helper and API routes do not exist.

- [ ] **Step 3: Implement decodeBody, body persistence, and the API routes**

Create `src/bodies/decodeBody.ts`:

```ts
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

export function decodeBody(input: {
  payload: Buffer;
  contentEncoding: string | undefined;
  contentType: string | undefined;
  maxPreviewBytes: number;
}) {
  let decoded = input.payload;

  if (input.contentEncoding === "gzip") {
    decoded = gunzipSync(decoded);
  } else if (input.contentEncoding === "br") {
    decoded = brotliDecompressSync(decoded);
  } else if (input.contentEncoding === "deflate") {
    decoded = inflateSync(decoded);
  }

  const text = decoded.toString("utf8");
  return {
    preview: text.slice(0, input.maxPreviewBytes),
    truncated: text.length > input.maxPreviewBytes,
    previewable: /^application\/json|^text\//.test(input.contentType ?? ""),
  };
}
```

Create `src/storage/bodyStore.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function createBodyStore(baseDir: string) {
  mkdirSync(baseDir, { recursive: true });

  return {
    writeBody(kind: "request" | "response", payload: Buffer) {
      const filePath = join(baseDir, `${kind}-${randomUUID()}.bin`);
      writeFileSync(filePath, payload);
      return filePath;
    },
  };
}
```

Update `src/proxy/sessionCollector.ts` so finalized sessions carry request and response body metadata:

```ts
export function finalizePendingSession(
  pending: NewSessionRecord,
  response: {
    status: number;
    headers: IncomingHttpHeaders;
    durationMs: number;
    requestBodyPath: string | null;
    requestBodyPreview: string | null;
    responseBodyPath: string | null;
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
```

Update `src/proxy/createProxyServer.ts` to persist request and response bodies and feed previews into the repository:

```ts
import { createBodyStore } from "../storage/bodyStore.js";
import { decodeBody } from "../bodies/decodeBody.js";

export async function startProxyServer({ port, repository, bus, certificateDir, bodyDir }: ProxyDeps) {
  mkdirSync(certificateDir, { recursive: true });
  const bodyStore = createBodyStore(bodyDir);
  const proxy = Proxy();

  proxy.onRequest((ctx, callback) => {
    const startedAt = Date.now();
    const url = new URL(ctx.clientToProxyRequest.url ?? "/", `${ctx.isSSL ? "https" : "http"}://${ctx.clientToProxyRequest.headers.host}`);
    const pending = createPendingSession({
      startedAt: new Date(startedAt).toISOString(),
      scheme: ctx.isSSL ? "https" : "http",
      method: ctx.clientToProxyRequest.method ?? "GET",
      host: url.host,
      path: url.pathname,
      query: url.search,
      requestHeaders: ctx.clientToProxyRequest.headers,
    });

    const requestChunks: Buffer[] = [];
    const responseChunks: Buffer[] = [];

    ctx.onRequestData((_, chunk, done) => {
      requestChunks.push(Buffer.from(chunk));
      return done(null, chunk);
    });

    ctx.onResponseData((_, chunk, done) => {
      responseChunks.push(Buffer.from(chunk));
      return done(null, chunk);
    });

    ctx.onResponseEnd((_, done) => {
      const requestPayload = Buffer.concat(requestChunks);
      const responsePayload = Buffer.concat(responseChunks);
      const requestBodyPath = requestPayload.length > 0 ? bodyStore.writeBody("request", requestPayload) : null;
      const responseBodyPath = responsePayload.length > 0 ? bodyStore.writeBody("response", responsePayload) : null;

      const requestPreview = requestPayload.length
        ? decodeBody({
            payload: requestPayload,
            contentEncoding: pending.requestHeaders["content-encoding"],
            contentType: pending.requestHeaders["content-type"],
            maxPreviewBytes: 4096,
          }).preview
        : null;

      const responsePreview = responsePayload.length
        ? decodeBody({
            payload: responsePayload,
            contentEncoding: ctx.serverToProxyResponse.headers["content-encoding"] as string | undefined,
            contentType: ctx.serverToProxyResponse.headers["content-type"] as string | undefined,
            maxPreviewBytes: 4096,
          }).preview
        : null;

      const completed = finalizePendingSession(pending, {
        status: ctx.serverToProxyResponse.statusCode ?? 0,
        headers: ctx.serverToProxyResponse.headers,
        durationMs: Date.now() - startedAt,
        requestBodyPath,
        requestBodyPreview: requestPreview,
        responseBodyPath,
        responseBodyPreview: responsePreview,
      });

      const id = repository.insertSession(completed);
      const stored = repository.getSession(id);
      if (stored) {
        bus.publish(stored);
      }
      return done();
    });

    return callback();
  });
```

Create `src/http/routes/sessionRoutes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { createSessionRepository } from "../../storage/sessionRepository.js";

export async function registerSessionRoutes(
  app: FastifyInstance,
  repository: ReturnType<typeof createSessionRepository>,
) {
  app.get("/api/sessions", async () => repository.listSessions());

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    const session = repository.getSession(request.params.id);
    if (!session) {
      reply.code(404);
      return { message: "Session not found" };
    }
    return session;
  });
}
```

Create `src/http/routes/setupRoutes.ts`:

```ts
import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { readCertificateState } from "../../ca/caStore.js";

export async function registerSetupRoutes(
  app: FastifyInstance,
  input: {
    proxyPort: number;
    certificateDir: string;
  },
) {
  app.get("/api/setup", async () => ({
    proxyPort: input.proxyPort,
    certificate: readCertificateState(input.certificateDir),
    androidSteps: [
      "Connect the Android device to the same Wi-Fi network as this computer.",
      "Set the Wi-Fi proxy host to this computer and the port to the proxy port above.",
      "Install and trust the generated CA certificate if the app should allow HTTPS interception."
    ],
  }));

  app.get("/api/certificate", async (_, reply) => {
    const state = readCertificateState(input.certificateDir);
    if (!state.exists) {
      reply.code(404);
      return { message: "CA certificate has not been generated yet" };
    }

    reply.header("content-type", "application/x-pem-file");
    return reply.send(createReadStream(state.caPath));
  });
}
```

Update `src/server.ts` so the app exposes the repository-backed routes:

```ts
import { appConfig } from "./config.js";
import { openDatabase } from "./storage/db.js";
import { createSessionRepository } from "./storage/sessionRepository.js";
import { registerSessionRoutes } from "./http/routes/sessionRoutes.js";
import { registerSetupRoutes } from "./http/routes/setupRoutes.js";

export async function buildApp(overrides: Partial<{ dataDir: string; proxyPort: number }> = {}) {
  const dataDir = overrides.dataDir ?? appConfig.dataDir;
  const proxyPort = overrides.proxyPort ?? appConfig.proxyPort;
  const databasePath = `${dataDir}/sessions.db`;
  const certificateDir = `${dataDir}/certs`;

  const app = Fastify();
  const repository = createSessionRepository(openDatabase(databasePath));

  await registerHealthRoutes(app);
  await registerSessionRoutes(app, repository);
  await registerSetupRoutes(app, { proxyPort, certificateDir });

  return app;
}
```

- [ ] **Step 4: Run the decode and API tests to verify they pass**

Run:

```bash
npm test -- --run tests/bodies/decodeBody.test.ts tests/http/routes.test.ts
```

Expected: PASS with the decode helper and setup/session routes working.

- [ ] **Step 5: Commit the decode and API layer**

Run:

```bash
git add src/bodies/decodeBody.ts src/storage/bodyStore.ts src/proxy/sessionCollector.ts src/proxy/createProxyServer.ts src/http/routes/sessionRoutes.ts src/http/routes/setupRoutes.ts src/server.ts tests/bodies/decodeBody.test.ts tests/http/routes.test.ts
git commit -m "feat: add decode and api routes"
```

## Task 6: Add the live dashboard and manual verification docs

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/styles.css`
- Modify: `src/server.ts`
- Create: `README.md`
- Test: `tests/http/routes.test.ts`

- [ ] **Step 1: Extend the route test to assert the dashboard shell and SSE endpoint are served**

Append this test to `tests/http/routes.test.ts`:

```ts
  it("serves the dashboard shell", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "proxy-ui-"));
    dataDirs.push(dataDir);

    const app = await buildApp({ dataDir });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Android Proxy Dashboard");
    expect(response.body).toContain("Session List");
  });

  it("exposes the SSE endpoint", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "proxy-events-"));
    dataDirs.push(dataDir);

    const app = await buildApp({ dataDir });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/events" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
  });
```

- [ ] **Step 2: Run the route test to verify the dashboard assertion fails**

Run:

```bash
npm test -- --run tests/http/routes.test.ts
```

Expected: FAIL because no static dashboard files are registered.

- [ ] **Step 3: Implement the static dashboard and SSE endpoint**

Create `public/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Android Proxy Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="layout">
      <section class="pane pane-list">
        <h1>Android Proxy Dashboard</h1>
        <h2>Session List</h2>
        <input id="filter" placeholder="Filter by host or path" />
        <ul id="session-list"></ul>
      </section>
      <section class="pane pane-detail">
        <h2>Session Detail</h2>
        <pre id="session-detail">Select a session</pre>
      </section>
      <aside class="pane pane-setup">
        <h2>Setup & Diagnostics</h2>
        <pre id="setup-panel">Loading...</pre>
      </aside>
    </main>
    <script type="module" src="/app.js"></script>
  </body>
</html>
```

Create `public/app.js`:

```js
const sessionList = document.getElementById("session-list");
const sessionDetail = document.getElementById("session-detail");
const setupPanel = document.getElementById("setup-panel");
const filterInput = document.getElementById("filter");

let sessions = [];

function renderList() {
  const filter = filterInput.value.toLowerCase();
  sessionList.innerHTML = "";

  for (const session of sessions.filter((item) => `${item.host}${item.path}`.toLowerCase().includes(filter))) {
    const li = document.createElement("li");
    li.textContent = `${session.method} ${session.host}${session.path} ${session.responseStatus ?? "ERR"}`;
    li.onclick = async () => {
      const response = await fetch(`/api/sessions/${session.id}`);
      const detail = await response.json();
      sessionDetail.textContent = JSON.stringify(detail, null, 2);
    };
    sessionList.appendChild(li);
  }
}

async function loadSetup() {
  const response = await fetch("/api/setup");
  setupPanel.textContent = JSON.stringify(await response.json(), null, 2);
}

async function loadSessions() {
  const response = await fetch("/api/sessions");
  sessions = await response.json();
  renderList();
}

filterInput.addEventListener("input", renderList);

const events = new EventSource("/api/events");
events.addEventListener("session", (event) => {
  sessions.unshift(JSON.parse(event.data));
  renderList();
});

await loadSetup();
await loadSessions();
```

Create `public/styles.css`:

```css
body {
  margin: 0;
  font-family: "Segoe UI", sans-serif;
  background: #0f172a;
  color: #e2e8f0;
}

.layout {
  display: grid;
  grid-template-columns: 1.2fr 1.4fr 1fr;
  min-height: 100vh;
}

.pane {
  border-right: 1px solid #1e293b;
  padding: 16px;
  box-sizing: border-box;
}

#session-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}

#session-list li {
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
}

#session-list li:hover {
  background: #1e293b;
}

pre {
  white-space: pre-wrap;
  word-break: break-word;
}
```

Update `src/server.ts` to register static assets and SSE, and to start the proxy with the same repository and event bus when the app runs directly:

```ts
import fastifyStatic from "@fastify/static";
import { join } from "node:path";
import Fastify from "fastify";
import { appConfig } from "./config.js";
import { createSessionEventBus } from "./realtime/sessionEventBus.js";
import { openDatabase } from "./storage/db.js";
import { createSessionRepository } from "./storage/sessionRepository.js";
import { registerHealthRoutes } from "./http/routes/healthRoutes.js";
import { registerSessionRoutes } from "./http/routes/sessionRoutes.js";
import { registerSetupRoutes } from "./http/routes/setupRoutes.js";
import { startProxyServer } from "./proxy/createProxyServer.js";

export async function buildApp(overrides: Partial<{ dataDir: string; proxyPort: number }> = {}) {
  const dataDir = overrides.dataDir ?? appConfig.dataDir;
  const proxyPort = overrides.proxyPort ?? appConfig.proxyPort;
  const certificateDir = `${dataDir}/certs`;
  const bodyDir = `${dataDir}/bodies`;
  const repository = createSessionRepository(openDatabase(`${dataDir}/sessions.db`));
  const bus = createSessionEventBus();
  const app = Fastify();

  await app.register(fastifyStatic, {
    root: join(process.cwd(), "public"),
  });

  await registerHealthRoutes(app);
  await registerSessionRoutes(app, repository);
  await registerSetupRoutes(app, { proxyPort, certificateDir });

  app.get("/api/events", async (_, reply) => {
    reply.raw.setHeader("content-type", "text/event-stream");
    reply.raw.setHeader("cache-control", "no-cache");
    reply.raw.setHeader("connection", "keep-alive");

    const unsubscribe = bus.subscribe((session) => {
      reply.raw.write(`event: session\n`);
      reply.raw.write(`data: ${JSON.stringify(session)}\n\n`);
    });

    reply.raw.on("close", unsubscribe);
    reply.hijack();
  });

  app.decorate("proxyRuntime", {
    proxyPort,
    certificateDir,
    bodyDir,
    repository,
    bus,
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildApp();
  const runtime = app.proxyRuntime as {
    proxyPort: number;
    certificateDir: string;
    bodyDir: string;
    repository: ReturnType<typeof createSessionRepository>;
    bus: ReturnType<typeof createSessionEventBus>;
  };

  const proxy = await startProxyServer({
    port: runtime.proxyPort,
    repository: runtime.repository,
    bus: runtime.bus,
    certificateDir: runtime.certificateDir,
    bodyDir: runtime.bodyDir,
  });

  app.addHook("onClose", async () => {
    await proxy.close();
  });

  await app.listen({ host: "127.0.0.1", port: appConfig.httpPort });
}
```

Create `README.md`:

```md
# Android Proxy Dashboard

## Run locally

~~~bash
npm install
npm run dev
~~~

Open `http://127.0.0.1:3000` and set the Android Wi-Fi proxy to `your-computer-ip:8080`.

## Android HTTPS setup

1. Visit `http://127.0.0.1:3000/api/setup`.
2. Download the certificate from `http://127.0.0.1:3000/api/certificate`.
3. Install and trust it on the Android device.
4. Launch the target app and verify sessions appear in the Session List pane.
```

- [ ] **Step 4: Run the route test to verify the dashboard passes**

Run:

```bash
npm test -- --run tests/http/routes.test.ts
```

Expected: PASS with the dashboard shell available at `/`.

- [ ] **Step 5: Run the full suite**

Run:

```bash
npm test
```

Expected: PASS across health, repository, decode, HTTP proxy, HTTPS MITM, and route tests.

- [ ] **Step 6: Commit the dashboard**

Run:

```bash
git add public/index.html public/app.js public/styles.css src/server.ts README.md tests/http/routes.test.ts
git commit -m "feat: add live proxy dashboard"
```

## Manual Verification Checklist

Run this after Task 6:

1. Start the app with `npm run dev`.
2. Open `http://127.0.0.1:3000`.
3. Confirm the setup pane shows `proxyPort: 8080`.
4. Configure an Android device on the same Wi-Fi network to use the computer's IP address with port `8080`.
5. Download and install the CA certificate from `/api/certificate`.
6. Launch a test app you control.
7. Confirm new sessions appear in the list and can be opened in the detail pane.
8. Confirm a request to a pinned or non-trusting app records a visible failure rather than a false success.
