const state = {
  sessions: [],
  selectedId: null,
  filter: "",
  flashId: null,
  flashTimerId: null,
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

function getErrorMessage(error, fallback) {
  if (error instanceof AppRequestError) {
    if (error.kind === "network") {
      return "網路連線失敗，請確認服務狀態後重試。";
    }
    if (error.kind === "parse") {
      return "伺服器回傳資料格式異常。";
    }
    if (error.kind === "http") {
      if (error.status === 404) {
        return "找不到指定資源（HTTP 404）。";
      }
      if (error.status !== null && error.status >= 500) {
        return `伺服器暫時無法回應（HTTP ${error.status}）。`;
      }
      return `請求失敗（HTTP ${error.status ?? "未知"}）。`;
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
    return "<p class=\"placeholder\">未擷取到任何標頭。</p>";
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
    return `<section><h4>${label}</h4><p class="placeholder">目前沒有可用內容預覽。</p></section>`;
  }

  return `<section><h4>${label}</h4><pre>${escapeHtml(preview)}</pre></section>`;
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
  updateChip(elements.liveStatus, `即時連線：${label}`, status);
}

function updateSessionCount(visibleCount, totalCount) {
  const countText =
    visibleCount === totalCount
      ? `${visibleCount} 筆`
      : `${visibleCount}/${totalCount} 筆`;

  if (elements.count) {
    elements.count.textContent = countText;
  }

  if (elements.sessionCountChip) {
    elements.sessionCountChip.dataset.state =
      totalCount === 0 ? "idle" : "active";
    elements.sessionCountChip.title = `目前顯示 ${countText} 流量事件`;
  }
}

function setSessionCountChipState(status, title = "") {
  if (!elements.sessionCountChip) {
    return;
  }
  elements.sessionCountChip.dataset.state = status;
  elements.sessionCountChip.title = title;
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

  updateSessionCount(visibleSessions.length, state.sessions.length);
  elements.list.innerHTML = "";

  if (visibleSessions.length === 0) {
    elements.list.innerHTML = filter
      ? "<p class=\"placeholder\">查無符合篩選條件的流量事件。</p>"
      : "<p class=\"placeholder\">尚未收到任何流量事件。</p>";
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
    item.querySelector(".meta").textContent = `${session.scheme.toUpperCase()} ${session.responseStatus ?? "待回應"} ${new Date(session.startedAt).toLocaleString("zh-TW")}`;
    item.addEventListener("click", () => {
      void loadSessionDetail(session.id);
    });
    elements.list.append(item);
  }
}

function renderDetail(session) {
  if (!session) {
    elements.detail.innerHTML =
      "<p class=\"placeholder\">請先選擇一筆事件以檢視封包剖析。</p>";
    return;
  }

  elements.detail.innerHTML = `
    <section>
      <h3>${escapeHtml(session.method)} ${escapeHtml(session.host)}${escapeHtml(session.path)}</h3>
      <p class="summary">
        ${escapeHtml(session.scheme.toUpperCase())} |
        狀態 ${escapeHtml(session.responseStatus ?? "待回應")} |
        耗時 ${escapeHtml(session.durationMs ?? "N/A")} ms
      </p>
    </section>
    <section>
      <h4>請求標頭</h4>
      ${formatHeaders(session.requestHeaders)}
    </section>
    ${formatPreview("請求本文預覽", session.requestBodyPreview)}
    <section>
      <h4>回應標頭</h4>
      ${formatHeaders(session.responseHeaders)}
    </section>
    ${formatPreview("回應本文預覽", session.responseBodyPreview)}
  `;
}

function renderSetup(setup) {
  const certificateText = setup.certificate.exists
    ? "憑證已建立，可下載安裝。"
    : "尚未建立 CA 憑證，請先完成初始化。";

  updateChip(
    elements.proxyPortChip,
    `代理埠：${setup.proxyPort}`,
    "online",
    `目前代理監聽埠為 ${setup.proxyPort}`,
  );
  updateChip(
    elements.certificateStatus,
    setup.certificate.exists ? "憑證：已就緒" : "憑證：尚未建立",
    setup.certificate.exists ? "online" : "warning",
    setup.certificate.exists && setup.certificate.caPath
      ? `憑證路徑：${setup.certificate.caPath}`
      : "",
  );

  elements.setup.innerHTML = `
    <section>
      <h3>代理埠</h3>
      <p>${escapeHtml(setup.proxyPort)}</p>
    </section>
    <section>
      <h3>憑證狀態</h3>
      <p>${escapeHtml(certificateText)}</p>
      <p><a href="/api/certificate">下載 CA 憑證</a></p>
    </section>
    <section>
      <h3>Android 設定步驟</h3>
      <ol class="steps">
        ${setup.androidSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
      </ol>
    </section>
  `;
}

async function loadSessionDetail(id) {
  state.selectedId = id;
  renderList();
  elements.detail.innerHTML =
    "<p class=\"placeholder\">正在載入封包剖析資料。</p>";

  try {
    const session = await getJson(`/api/sessions/${id}`);
    renderDetail(session);
  } catch (error) {
    const message = getErrorMessage(error, "讀取封包剖析失敗。");
    elements.detail.innerHTML = `<p class="placeholder">${escapeHtml(`讀取封包剖析失敗：${message}`)}</p>`;
  }
}

async function loadSetup() {
  try {
    const setup = await getJson("/api/setup");
    renderSetup(setup);
  } catch (error) {
    updateChip(elements.proxyPortChip, "代理埠：讀取失敗", "error");
    updateChip(elements.certificateStatus, "憑證：讀取失敗", "error");
    const message = getErrorMessage(error, "讀取節點診斷失敗。");
    elements.setup.innerHTML = `<p class="placeholder">${escapeHtml(`讀取節點診斷失敗：${message}`)}</p>`;
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
        ? "目前尚未收到流量事件"
        : `目前共 ${state.sessions.length} 筆流量事件`,
    );
    if (!state.selectedId && state.sessions.length > 0) {
      await loadSessionDetail(state.sessions[0].id);
    } else if (state.selectedId) {
      renderList();
    }
    return true;
  } catch (error) {
    const message = getErrorMessage(error, "讀取流量事件失敗。");
    elements.list.innerHTML = `<p class="placeholder">${escapeHtml(`讀取流量事件失敗：${message}`)}</p>`;
    setSessionCountChipState("error", `流量事件同步失敗：${message}`);
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

    setLiveStatus("同步中", "syncing");
    syncInFlight = (async () => {
      const ok = await loadSessions();
      setLiveStatus(ok ? "已連線" : "同步失敗", ok ? "online" : "warning");
    })();

    try {
      await syncInFlight;
    } finally {
      syncInFlight = null;
    }
  }

  setLiveStatus("連線中", "syncing");

  eventSource.addEventListener("open", () => {
    void resyncSessions();
  });

  eventSource.addEventListener("session", (event) => {
    setLiveStatus("已連線", "online");
    const session = JSON.parse(event.data);
    prependSession(session);
  });
  eventSource.onerror = () => {
    setLiveStatus("重連中", "warning");
  };
}

updateSessionCount(0, 0);
setLiveStatus("同步中", "syncing");

if (elements.filter) {
  elements.filter.addEventListener("input", (event) => {
    state.filter = event.target.value;
    renderList();
  });
}

subscribeToEvents();
await loadSetup();
