# Dockerization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Android Proxy Dashboard as a single Dockerized service that runs the dashboard and proxy together with persistent application data.

**Architecture:** Keep the existing single-process Fastify plus proxy runtime intact, and make only the runtime configuration changes needed for container execution. Add a Docker-focused entrypoint, Compose wiring for ports and persistent data, and documentation that explains host-vs-container networking for Android setup.

**Tech Stack:** Node.js, Fastify, TypeScript, Docker, Docker Compose, Vitest

---

## File Structure

- Modify: `package.json`
  - Add a non-watch `start` script for container startup.
- Modify: `src/config.ts`
  - Add configurable dashboard bind host support via `APP_HOST`.
- Modify: `src/server.ts`
  - Use the configured dashboard bind host for direct-run startup.
- Create: `tests/config.test.ts`
  - Cover `APP_HOST` defaults and overrides.
- Create: `Dockerfile`
  - Define the single-container runtime image.
- Create: `.dockerignore`
  - Keep the build context small and free of local state.
- Create: `docker-compose.yml`
  - Publish dashboard and proxy ports and persist `DATA_DIR`.
- Modify: `README.md`
  - Document Docker usage, persistence, and Android proxy setup when containerized.

### Task 1: Make Dashboard Host Configurable for Container Runtime

**Files:**
- Create: `tests/config.test.ts`
- Modify: `src/config.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write the failing config test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadConfig() {
  vi.resetModules();
  return import("../src/config.js");
}

describe("appConfig.httpHost", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults the dashboard host to loopback for local development", async () => {
    const { appConfig } = await loadConfig();
    expect(appConfig.httpHost).toBe("127.0.0.1");
  });

  it("allows overriding the dashboard host with APP_HOST", async () => {
    vi.stubEnv("APP_HOST", "0.0.0.0");
    const { appConfig } = await loadConfig();
    expect(appConfig.httpHost).toBe("0.0.0.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/config.test.ts
```

Expected: FAIL because `appConfig.httpHost` does not exist yet.

- [ ] **Step 3: Add the minimal runtime configuration**

```ts
const appPaths = resolveAppPaths(process.env.DATA_DIR ?? ".data");

export const appConfig = {
  httpHost: process.env.APP_HOST ?? "127.0.0.1",
  httpPort: Number(process.env.APP_PORT ?? 3000),
  proxyPort: Number(process.env.PROXY_PORT ?? 8080),
  proxyHost: process.env.PROXY_HOST ?? "0.0.0.0",
  dataDir: appPaths.dataDir,
  certificateDir: appPaths.certificateDir,
  bodyDir: appPaths.bodyDir,
  databasePath: appPaths.databasePath,
};
```

```ts
await app.listen({ host: appConfig.httpHost, port: appConfig.httpPort });
```

- [ ] **Step 4: Run targeted verification**

Run:

```bash
npm test -- tests/config.test.ts tests/server.test.ts
```

Expected: PASS, including the existing direct-run tests.

- [ ] **Step 5: Commit**

```bash
git add tests/config.test.ts src/config.ts src/server.ts
git commit -m "feat: add configurable dashboard host"
```

### Task 2: Add Container Runtime Assets

**Files:**
- Modify: `package.json`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`

- [ ] **Step 1: Add the failing container entrypoint expectation**

Check the scripts section and confirm there is no non-watch startup command for Docker.

Expected current scripts:

```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "build": "tsc --noEmit",
  "test": "vitest run"
}
```

- [ ] **Step 2: Add the runtime script and Docker assets**

Update `package.json`:

```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "start": "tsx src/server.ts",
  "build": "tsc --noEmit",
  "test": "vitest run"
}
```

Create `Dockerfile`:

```dockerfile
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV APP_HOST=0.0.0.0
ENV APP_PORT=3000
ENV PROXY_HOST=0.0.0.0
ENV PROXY_PORT=8080
ENV DATA_DIR=/app/.data

EXPOSE 3000 8080

CMD ["npm", "run", "start"]
```

Create `.dockerignore`:

```gitignore
node_modules/
.git/
.worktrees/
.superpowers/
.data/
docs/
coverage/
*.log
```

Create `docker-compose.yml`:

```yaml
services:
  app:
    build:
      context: .
    ports:
      - "3000:3000"
      - "8080:8080"
    environment:
      APP_HOST: 0.0.0.0
      APP_PORT: 3000
      PROXY_HOST: 0.0.0.0
      PROXY_PORT: 8080
      DATA_DIR: /app/.data
    volumes:
      - app-proxy-data:/app/.data

volumes:
  app-proxy-data:
```

- [ ] **Step 3: Run static verification for the new container assets**

Run:

```bash
npm run build
docker compose config
```

Expected:
- TypeScript check PASS
- Compose file renders without schema or interpolation errors

- [ ] **Step 4: Commit**

```bash
git add package.json Dockerfile .dockerignore docker-compose.yml
git commit -m "feat: add docker runtime assets"
```

### Task 3: Document Docker Workflow and Validate the Container

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Docker usage documentation**

Add a `## Docker` section to `README.md` covering:

````md
## Docker

Build and run:

```text
docker compose up --build
```

This publishes:

- dashboard on `http://127.0.0.1:3000`
- proxy on `host-lan-ip:8080`

Persistent data lives in the Compose volume mounted at `/app/.data`, including:

- generated CA files
- `sessions.db`
- stored request/response bodies

When configuring Android, use your computer's LAN IP as the proxy host, not `127.0.0.1`.
````

- [ ] **Step 2: Run end-to-end Docker validation**

Run:

```powershell
docker compose up --build -d
Invoke-WebRequest http://127.0.0.1:3000/health | Select-Object -ExpandProperty Content
docker compose down
```

Expected:
- container builds successfully
- container starts successfully
- health endpoint returns `{"ok":true}`
- named volume remains defined after shutdown

- [ ] **Step 3: Run final regression checks**

Run:

```bash
npm test
npm run build
```

Expected: PASS with no TypeScript regressions after the README and container changes.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add docker usage guide"
```
