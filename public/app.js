const state = {
  sessions: [],
  selectedId: null,
  filter: "",
  flashId: null,
  flashTimerId: null,
  httpsMode: "tunnel",
};

class AppRequestError extends Error {
  constructor(kind, status = null) {
    super(kind);
    this.name = "AppRequestError";
    this.kind = kind;
    this.status = status;
  }
}

const elements = {
  filter: document.querySelector("#session-filter"),
  list: document.querySelector("#session-list"),
  count: document.querySelector("#session-count"),
  sessionCountChip: document.querySelector("#session-count-chip"),
  proxyPortChip: document.querySelector("#proxy-port-chip"),
  certificateStatus: document.querySelector("#certificate-status"),
  liveStatus: document.querySelector("#live-status"),
  detail: document.querySelector("#session-detail"),
  setup: document.querySelector("#setup-detail"),
  template: document.querySelector("#session-item-template"),
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function mergeSessions(existingSessions, incomingSessions) {
  const sessionsById = new Map();
  for (const session of [...existingSessions, ...incomingSessions]) {
    sessionsById.set(session.id, session);
  }
  return Array.from(sessionsById.values()).sort((left, right) => {
    return Date.parse(right.startedAt) - Date.parse(left.startedAt);
  });
}

function updateChip(element, text, status, title = "") {
  if (!element) {
    return;
  }
  element.textContent = text;
  element.dataset.state = status;
  element.title = title;
}

function setLiveStatus(label, status) {
  updateChip(elements.liveStatus, `LIVE ${label}`, status);
}

function getHttpsModeLabel(mode) {
  return mode === "mitm" ? "HTTPS MITM (decrypt)" : "HTTPS Tunnel (no decrypt)";
}

function updateSessionCount(visibleCount, totalCount) {
  const countText =
    visibleCount === totalCount ? `${visibleCount} sessions` : `${visibleCount}/${totalCount} sessions`;

  if (elements.count) {
    elements.count.textContent = countText;
  }
  if (elements.sessionCountChip) {
    elements.sessionCountChip.dataset.state = totalCount === 0 ? "idle" : "active";
    elements.sessionCountChip.title = `Visible ${countText}`;
  }
}

function setSessionCountChipState(status, title = "") {
  if (!elements.sessionCountChip) {
    return;
  }
  elements.sessionCountChip.dataset.state = status;
  elements.sessionCountChip.title = title;
}

function getErrorMessage(error, fallback) {
  if (error instanceof AppRequestError) {
    if (error.kind === "network") {
      return "Network request failed";
    }
    if (error.kind === "parse") {
      return "Failed to parse server response";
    }
    if (error.kind === "http") {
      return `HTTP ${error.status ?? "unknown"}`;
    }
  }
  return fallback;
}

async function getJson(url) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new AppRequestError("network");
  }

  if (!response.ok) {
    throw new AppRequestError("http", response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new AppRequestError("parse");
  }
}

function formatHeaders(headers) {
  const entries = Object.entries(headers ?? {});
  if (entries.length === 0) {
    return '<p class="placeholder">No headers</p>';
  }

  return `<dl class="kv-list">${entries
    .map(
      ([key, value]) =>
        `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    )
    .join("")}</dl>`;
}

function formatPreview(label, preview) {
  if (!preview) {
    return `<section><h4>${label}</h4><p class="placeholder">No preview</p></section>`;
  }
  return `<section><h4>${label}</h4><pre>${escapeHtml(preview)}</pre></section>`;
}

function renderList() {
  const filter = state.filter.trim().toLowerCase();
  const visibleSessions = state.sessions.filter((session) => {
    if (!filter) {
      return true;
    }
    const haystack = [session.method, session.host, session.path, String(session.responseStatus ?? "")]
      .join(" ")
      .toLowerCase();
    return haystack.includes(filter);
  });

  updateSessionCount(visibleSessions.length, state.sessions.length);
  elements.list.innerHTML = "";

  if (visibleSessions.length === 0) {
    elements.list.innerHTML = filter
      ? '<p class="placeholder">No matching sessions</p>'
      : '<p class="placeholder">No captured sessions yet</p>';
    return;
  }

  for (const session of visibleSessions) {
    const item = elements.template.content.firstElementChild.cloneNode(true);
    item.dataset.sessionId = session.id;
    if (session.id === state.selectedId) {
      item.classList.add("active");
    }
    if (session.id === state.flashId) {
      item.classList.add("flash");
    }
    item.querySelector(".method").textContent = session.method;
    item.querySelector(".target").textContent = `${session.host}${session.path}`;
    item.querySelector(".meta").textContent = `${session.scheme.toUpperCase()} ${session.responseStatus ?? "PENDING"} ${new Date(session.startedAt).toLocaleString("zh-TW")}`;
    item.addEventListener("click", () => {
      void loadSessionDetail(session.id);
    });
    elements.list.append(item);
  }
}

function renderDetail(session) {
  if (!session) {
    elements.detail.innerHTML = '<p class="placeholder">Select a session to inspect details</p>';
    return;
  }

  elements.detail.innerHTML = `
    <section>
      <h3>${escapeHtml(session.method)} ${escapeHtml(session.host)}${escapeHtml(session.path)}</h3>
      <p class="summary">
        ${escapeHtml(session.scheme.toUpperCase())} |
        Status ${escapeHtml(session.responseStatus ?? "PENDING")} |
        Duration ${escapeHtml(session.durationMs ?? "N/A")} ms
      </p>
    </section>
    <section>
      <h4>Request Headers</h4>
      ${formatHeaders(session.requestHeaders)}
    </section>
    ${formatPreview("Request Body Preview", session.requestBodyPreview)}
    <section>
      <h4>Response Headers</h4>
      ${formatHeaders(session.responseHeaders)}
    </section>
    ${formatPreview("Response Body Preview", session.responseBodyPreview)}
  `;
}

async function switchHttpsMode(mode) {
  try {
    const response = await fetch("/api/setup/https-mode", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ mode }),
    });
    if (!response.ok) {
      throw new AppRequestError("http", response.status);
    }
    await loadSetup();
    setLiveStatus("mode switched", "online");
    const errorNode = elements.setup.querySelector("#https-mode-error");
    if (errorNode) {
      errorNode.textContent = "";
    }
  } catch (error) {
    const message = getErrorMessage(error, "failed to switch HTTPS mode");
    setLiveStatus("switch failed", "warning");
    const errorNode = elements.setup.querySelector("#https-mode-error");
    if (errorNode) {
      errorNode.textContent = `HTTPS mode switch failed: ${message}`;
      return;
    }
    const fallback = document.createElement("p");
    fallback.className = "placeholder";
    fallback.textContent = `HTTPS mode switch failed: ${message}`;
    elements.setup.append(fallback);
  }
}

function renderSetup(setup) {
  state.httpsMode = setup.httpsMode === "mitm" ? "mitm" : "tunnel";
  const certificateText = setup.certificate.exists
    ? "CA certificate ready"
    : "CA certificate not generated yet";
  const nextMode = state.httpsMode === "mitm" ? "tunnel" : "mitm";

  updateChip(
    elements.proxyPortChip,
    `Proxy ${setup.proxyPort}`,
    "online",
    `Proxy listening port ${setup.proxyPort}`,
  );
  updateChip(
    elements.certificateStatus,
    setup.certificate.exists ? "CA ready" : "CA missing",
    setup.certificate.exists ? "online" : "warning",
    setup.certificate.exists && setup.certificate.caPath
      ? `CA path: ${setup.certificate.caPath}`
      : "",
  );

  elements.setup.innerHTML = `
    <section>
      <h3>Proxy Port</h3>
      <p>${escapeHtml(setup.proxyPort)}</p>
    </section>
    <section>
      <h3>Certificate</h3>
      <p>${escapeHtml(certificateText)}</p>
      <p><a href="/api/certificate">Download CA certificate</a></p>
    </section>
    <section>
      <h3>HTTPS Mode</h3>
      <p>Current: ${escapeHtml(getHttpsModeLabel(state.httpsMode))}</p>
      <button id="https-mode-toggle" class="mode-toggle" type="button" data-next-mode="${nextMode}">
        Switch to ${escapeHtml(getHttpsModeLabel(nextMode))}
      </button>
      <p id="https-mode-error" class="placeholder"></p>
    </section>
    <section>
      <h3>Android Steps</h3>
      <ol class="steps">
        ${setup.androidSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
      </ol>
    </section>
  `;

  const toggle = elements.setup.querySelector("#https-mode-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const mode = toggle.dataset.nextMode;
      if (mode === "mitm" || mode === "tunnel") {
        void switchHttpsMode(mode);
      }
    });
  }
}

async function loadSessionDetail(id) {
  state.selectedId = id;
  renderList();
  elements.detail.innerHTML = '<p class="placeholder">Loading session detail...</p>';

  try {
    const session = await getJson(`/api/sessions/${id}`);
    renderDetail(session);
  } catch (error) {
    const message = getErrorMessage(error, "failed to load session detail");
    elements.detail.innerHTML = `<p class="placeholder">${escapeHtml(`Failed to load session detail: ${message}`)}</p>`;
  }
}

async function loadSetup() {
  try {
    const setup = await getJson("/api/setup");
    renderSetup(setup);
  } catch (error) {
    updateChip(elements.proxyPortChip, "Proxy load failed", "error");
    updateChip(elements.certificateStatus, "CA load failed", "error");
    const message = getErrorMessage(error, "failed to load setup");
    elements.setup.innerHTML = `<p class="placeholder">${escapeHtml(`Failed to load setup: ${message}`)}</p>`;
  }
}

async function loadSessions() {
  try {
    const sessions = await getJson("/api/sessions");
    state.sessions = mergeSessions(state.sessions, sessions);
    renderList();
    setSessionCountChipState(
      state.sessions.length === 0 ? "idle" : "active",
      state.sessions.length === 0
        ? "No sessions captured"
        : `Total ${state.sessions.length} sessions`,
    );
    if (!state.selectedId && state.sessions.length > 0) {
      await loadSessionDetail(state.sessions[0].id);
    } else if (state.selectedId) {
      renderList();
    }
    return true;
  } catch (error) {
    const message = getErrorMessage(error, "failed to load sessions");
    elements.list.innerHTML = `<p class="placeholder">${escapeHtml(`Failed to load sessions: ${message}`)}</p>`;
    setSessionCountChipState("error", `Session load failed: ${message}`);
    return false;
  }
}

function triggerSessionFlash(sessionId) {
  state.flashId = sessionId;
  if (state.flashTimerId !== null) {
    clearTimeout(state.flashTimerId);
  }

  state.flashTimerId = window.setTimeout(() => {
    if (state.flashId === sessionId) {
      state.flashId = null;
      renderList();
    }
    state.flashTimerId = null;
  }, 1600);
}

function prependSession(session) {
  const hadSelection = state.selectedId !== null;
  state.sessions = mergeSessions(state.sessions, [session]);
  triggerSessionFlash(session.id);
  renderList();
  if (!hadSelection) {
    void loadSessionDetail(session.id);
  }
}

function subscribeToEvents() {
  const eventSource = new EventSource("/api/events");
  let syncInFlight = null;

  async function resyncSessions() {
    if (syncInFlight) {
      return syncInFlight;
    }

    setLiveStatus("syncing", "syncing");
    syncInFlight = (async () => {
      const ok = await loadSessions();
      setLiveStatus(ok ? "online" : "warning", ok ? "online" : "warning");
    })();

    try {
      await syncInFlight;
    } finally {
      syncInFlight = null;
    }
  }

  setLiveStatus("connecting", "syncing");

  eventSource.addEventListener("open", () => {
    void resyncSessions();
  });

  eventSource.addEventListener("session", (event) => {
    setLiveStatus("online", "online");
    const session = JSON.parse(event.data);
    prependSession(session);
  });

  eventSource.onerror = () => {
    setLiveStatus("disconnected", "warning");
  };
}

updateSessionCount(0, 0);
setLiveStatus("connecting", "syncing");

if (elements.filter) {
  elements.filter.addEventListener("input", (event) => {
    state.filter = event.target.value;
    renderList();
  });
}

subscribeToEvents();
await loadSetup();
