const state = {
  sessions: [],
  selectedId: null,
  filter: "",
};

const elements = {
  filter: document.querySelector("#session-filter"),
  list: document.querySelector("#session-list"),
  count: document.querySelector("#session-count"),
  detail: document.querySelector("#session-detail"),
  setup: document.querySelector("#setup-detail"),
  template: document.querySelector("#session-item-template"),
};

function mergeSessions(existingSessions, incomingSessions) {
  const sessionsById = new Map();

  for (const session of [...existingSessions, ...incomingSessions]) {
    sessionsById.set(session.id, session);
  }

  return Array.from(sessionsById.values()).sort((left, right) => {
    return Date.parse(right.startedAt) - Date.parse(left.startedAt);
  });
}

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

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return response.json();
}

function formatHeaders(headers) {
  const entries = Object.entries(headers ?? {});
  if (entries.length === 0) {
    return "<p class=\"placeholder\">No headers captured.</p>";
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
    return `<section><h4>${label}</h4><p class="placeholder">No preview available.</p></section>`;
  }

  return `<section><h4>${label}</h4><pre>${escapeHtml(preview)}</pre></section>`;
}

function renderList() {
  const filter = state.filter.trim().toLowerCase();
  const visibleSessions = state.sessions.filter((session) => {
    if (!filter) {
      return true;
    }

    const haystack = [
      session.method,
      session.host,
      session.path,
      String(session.responseStatus ?? ""),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(filter);
  });

  elements.count.textContent = `${visibleSessions.length} session${visibleSessions.length === 1 ? "" : "s"}`;
  elements.list.innerHTML = "";

  if (visibleSessions.length === 0) {
    elements.list.innerHTML = "<p class=\"placeholder\">No sessions match the current filter.</p>";
    return;
  }

  for (const session of visibleSessions) {
    const item = elements.template.content.firstElementChild.cloneNode(true);
    item.dataset.sessionId = session.id;
    if (session.id === state.selectedId) {
      item.classList.add("active");
    }
    item.querySelector(".method").textContent = session.method;
    item.querySelector(".target").textContent = `${session.host}${session.path}`;
    item.querySelector(".meta").textContent = `${session.scheme.toUpperCase()} ${session.responseStatus ?? "PENDING"} ${new Date(session.startedAt).toLocaleString()}`;
    item.addEventListener("click", () => {
      void loadSessionDetail(session.id);
    });
    elements.list.append(item);
  }
}

function renderDetail(session) {
  if (!session) {
    elements.detail.innerHTML =
      "<p class=\"placeholder\">Select a session to view request and response details.</p>";
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

function renderSetup(setup) {
  const certificateText = setup.certificate.exists
    ? `Certificate ready at ${setup.certificate.caPath}`
    : "Certificate has not been generated yet.";

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
      <h3>Android Setup</h3>
      <ol class="steps">
        ${setup.androidSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
      </ol>
    </section>
  `;
}

async function loadSessionDetail(id) {
  state.selectedId = id;
  renderList();
  elements.detail.innerHTML = "<p class=\"placeholder\">Loading session details.</p>";

  try {
    const session = await getJson(`/api/sessions/${id}`);
    renderDetail(session);
  } catch (error) {
    elements.detail.innerHTML = `<p class="placeholder">${escapeHtml(error.message)}</p>`;
  }
}

async function loadSetup() {
  try {
    const setup = await getJson("/api/setup");
    renderSetup(setup);
  } catch (error) {
    elements.setup.innerHTML = `<p class="placeholder">${escapeHtml(error.message)}</p>`;
  }
}

async function loadSessions() {
  try {
    const sessions = await getJson("/api/sessions");
    state.sessions = mergeSessions(state.sessions, sessions);
    renderList();
    if (!state.selectedId && state.sessions.length > 0) {
      await loadSessionDetail(state.sessions[0].id);
    } else if (state.selectedId) {
      renderList();
    }
  } catch (error) {
    elements.list.innerHTML = `<p class="placeholder">${escapeHtml(error.message)}</p>`;
  }
}

function prependSession(session) {
  const hadSelection = state.selectedId !== null;
  state.sessions = mergeSessions([session], state.sessions);
  renderList();
  if (!hadSelection) {
    void loadSessionDetail(session.id);
  }
}

function subscribeToEvents() {
  const eventSource = new EventSource("/api/events");
  let initialSyncComplete = false;

  eventSource.addEventListener("open", () => {
    if (initialSyncComplete) {
      return;
    }

    initialSyncComplete = true;
    void loadSessions();
  });

  eventSource.addEventListener("session", (event) => {
    const session = JSON.parse(event.data);
    prependSession(session);
  });
  eventSource.onerror = () => {
    elements.count.textContent = "Reconnecting to live stream...";
  };
}

elements.filter.addEventListener("input", (event) => {
  state.filter = event.target.value;
  renderList();
});

subscribeToEvents();
await Promise.all([loadSetup(), loadSessions()]);
