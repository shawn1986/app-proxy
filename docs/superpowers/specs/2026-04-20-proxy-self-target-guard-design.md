# Proxy Self-Target Guard Design

## Summary

Add a proxy-side guard that detects requests targeting the proxy itself, blocks them before upstream forwarding, and emits structured diagnostics so the source of proxy-loop traffic can be identified quickly.

## Goals

- Stop self-target and proxy-loop requests before they generate large numbers of sessions.
- Log enough request fingerprint data to identify the offending client.
- Keep normal proxy traffic behavior unchanged.
- Add automated coverage for the guard behavior.

## Non-Goals

- No changes to dashboard behavior or API routes.
- No session persistence for blocked self-target requests.
- No attempt to bypass or alter third-party client trust behavior.
- No full observability system or external log sink integration.

## Recommended Approach

Implement the guard in `src/proxy/createProxyServer.ts` at the start of `proxy.onRequest(...)`, before request forwarding begins.

This is the earliest safe point where the proxy has access to:

- the client connection
- the request method
- the `Host` header
- the request URL
- the configured proxy host and port

If the incoming request target resolves to the proxy itself, respond immediately with an explicit proxy-loop error response and do not create or store a session.

## Matching Rules

Treat the request as self-targeting when the resolved target host and port point at the running proxy, including common loopback aliases.

The initial guard must match at least:

- `127.0.0.1:<proxy-port>`
- `localhost:<proxy-port>`
- `0.0.0.0:<proxy-port>`
- the proxy's configured or resolved host with `<proxy-port>`

The guard should be conservative and focus on preventing obvious loops, rather than trying to normalize every possible hostname representation.

## Response Behavior

When a request is identified as self-targeting:

- do not forward upstream
- do not create a persisted session
- return an explicit error response indicating that the request targeted the proxy itself and was blocked to prevent a proxy loop

The response code should be a clear server-side error, such as `508` or another explicit loop-style failure code.

## Diagnostic Logging

Emit a structured log entry to stdout/stderr when the guard blocks a request.

The log must include:

- `event`: `PROXY_SELF_TARGET_BLOCKED`
- `clientIp`
- `method`
- `hostHeader`
- `requestUrl`
- `targetHost`
- `targetPort`
- `userAgent`
- `proxyHost`
- `proxyPort`

This diagnostic output is the primary mechanism for identifying the source of runaway self-target traffic.

## File Changes

- Modify: `src/proxy/createProxyServer.ts`
  - Add self-target detection, structured diagnostics, and early response handling.
- Modify: `tests/proxy/httpProxy.test.ts`
  - Add a test for blocked self-target requests and confirm no session is stored.

## Validation

Success criteria:

- Self-target requests are blocked before upstream forwarding.
- Blocked self-target requests do not create sessions in the repository.
- Structured diagnostics include the required request fingerprint fields.
- Existing proxy traffic tests still pass.
- `npm test` and `npm run build` pass after the change.

## Risks and Tradeoffs

### Hostname Matching Completeness

This first version focuses on obvious self-target cases and may not catch every hostname alias. That is acceptable for the hotfix because the immediate priority is to stop common proxy-loop storms and surface the offending source.

### Log Volume

If a client continues to hammer the proxy after the guard is added, structured logs may still be noisy. This is acceptable because it is materially better than flooding the session store, and the logs now contain actionable source information.
