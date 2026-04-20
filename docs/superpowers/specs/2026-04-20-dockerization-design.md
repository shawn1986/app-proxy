# Dockerization Design

## Summary

Package Android Proxy Dashboard as a single Dockerized service that runs both the dashboard web app and the explicit proxy in one container. The container should be easy to start locally with Docker Compose, expose the dashboard and proxy ports, and persist application data so CA state, sessions, and stored bodies survive restarts.

## Goals

- Run the dashboard and proxy together in one container.
- Provide a `docker-compose.yml` that is convenient for local use.
- Persist `DATA_DIR` so CA files, SQLite data, and body files survive container restarts.
- Preserve Android-device usability by exposing the proxy on a LAN-reachable host/port.
- Document Docker usage clearly in `README.md`.

## Non-Goals

- Splitting the app into multiple containers.
- Adding reverse proxies, TLS termination, or production orchestration.
- Reworking the runtime into a compiled build pipeline unless needed for the container entrypoint.
- Adding Docker-specific end-to-end Android tests.

## Recommended Approach

Use a single runtime container plus a `docker-compose.yml` file.

This is the best balance for the current project because:

- the app is already a single Node.js process that owns both web and proxy lifecycles
- Compose makes port and volume management easy
- persistent data can be handled with one named volume
- the result stays simple enough for local debugging

## Deliverables

- `Dockerfile`
- `.dockerignore`
- `docker-compose.yml`
- `package.json` update to add a non-watch container entrypoint script
- `src/config.ts` and `src/server.ts` update so the dashboard bind host is configurable for container use
- `README.md` updates with Docker instructions

## Container Runtime Design

The container runs one process:

- dashboard on port `3000`
- proxy on port `8080`

The dashboard remains accessed from the host machine at `http://127.0.0.1:3000`.

The proxy must be reachable from Android devices on the same LAN through the host machine IP and mapped proxy port.

Default runtime environment inside the container:

- `APP_HOST=0.0.0.0`
- `APP_PORT=3000`
- `PROXY_PORT=8080`
- `PROXY_HOST=0.0.0.0`
- `DATA_DIR=/app/.data`

The dashboard must bind to `0.0.0.0` inside the container, not `127.0.0.1`, or the mapped host port will not be reachable from the browser on the host machine. The implementation should therefore add an application host setting, for example `APP_HOST`, and make the server listen on that value.

## Data Persistence

Persist the whole `DATA_DIR` through one Docker volume.

This is preferred because:

- `certs/` and CA-related files remain stable, so Android devices do not need repeated certificate installation after container recreation
- `sessions.db` persists captured metadata
- `bodies/` persists request and response body files

Using one volume for `DATA_DIR` is simpler and less fragile than splitting persistence by subdirectory.

## Dockerfile Design

Use a Node.js base image and a simple runtime-focused layout:

1. set `WORKDIR /app`
2. copy `package.json` and `package-lock.json`
3. run `npm ci`
4. copy source files into the image
5. expose ports `3000` and `8080`
6. run the app with a non-watch startup command

The current `dev` script uses `tsx watch`, which is not appropriate as the default container process. Add a `start` script that runs `tsx src/server.ts`, and make the container use that command.

## Docker Compose Design

`docker-compose.yml` should define one service, for example `app`, with:

- build from the current project directory
- published ports:
  - `3000:3000`
  - `8080:8080`
- environment:
  - `APP_HOST=0.0.0.0`
  - `APP_PORT=3000`
  - `PROXY_PORT=8080`
  - `PROXY_HOST=0.0.0.0`
  - `DATA_DIR=/app/.data`
- one named volume mounted at `/app/.data`

This gives a single command local workflow while keeping the container state predictable.

## Docker Ignore Design

Exclude local-only and unnecessary files from the build context:

- `node_modules/`
- `.git/`
- `.worktrees/`
- `.superpowers/`
- `.data/`
- `docs/`
- test caches and temporary files

This keeps builds smaller and avoids shipping local state into the image.

## README Updates

Add a Docker section that covers:

- how to build and run with `docker compose up --build`
- where to access the dashboard
- how to configure the Android device to use the host machine LAN IP and proxy port
- which data is persisted in the volume
- how to stop and restart without losing CA/session state

## Validation

Success criteria for this Dockerization work:

- `docker compose build` succeeds
- `docker compose up` starts the app
- `GET /health` succeeds through the mapped dashboard port
- the dashboard is reachable in a browser
- the proxy port is published and intended for Android LAN access
- the mounted volume preserves `DATA_DIR` contents across container restarts

## Risks and Tradeoffs

### Running TypeScript Directly in the Container

Using `tsx src/server.ts` is not the smallest or most production-hardened runtime approach, but it is the least disruptive for this codebase and is appropriate for the current local-debugging goal.

### LAN Reachability Depends on Host Environment

Even with `PROXY_HOST=0.0.0.0` and mapped ports, host firewall rules and Docker networking can still block Android access. This is a documentation and environment risk, not a reason to complicate the container design.

### Single-Container Simplicity Over Separation

Combining the dashboard and proxy in one container is correct for this app today. Splitting them would add coordination cost without meaningful value for the current use case.
