# Dashboard Zh-TW Cyber Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 dashboard 改成繁體中文的資安終端風格監控台，採用頂部狀態列與下方雙欄主工作區，同時保留既有 API 與資料流。

**Architecture:** 保持前端仍由 `public/index.html`、`public/app.js`、`public/styles.css` 三個靜態檔案組成，不新增框架、不修改 backend。HTML 負責新的監控台骨架，JavaScript 負責繁中文案、即時狀態與 session 互動，CSS 重建深色 SOC 視覺與克制動畫。路由測試只驗證 dashboard shell 與核心文字/掛載點，互動細節以手動驗證補足。

**Tech Stack:** Fastify static assets, vanilla JavaScript, CSS, Vitest, TypeScript type-check (`tsc --noEmit`)

---

## File Structure

- Modify: `D:\Codes\mushroom\public\index.html`
  - 重組 dashboard shell，建立頂部狀態列、左欄流量事件、右欄封包剖析與節點診斷的 DOM 骨架
- Modify: `D:\Codes\mushroom\public\app.js`
  - 將所有可見文案繁中化，新增 live status 呈現、session 新增高亮與新的 setup 渲染結構
- Modify: `D:\Codes\mushroom\public\styles.css`
  - 重寫成深色資安終端風格，加入格線背景、狀態 chip、事件 feed、panel 高亮與克制動畫
- Modify: `D:\Codes\mushroom\tests\http\routes.test.ts`
  - 更新 dashboard shell 測試，確認繁中標題與新掛載區塊存在

## Task 1: 建立繁中監控台骨架

**Files:**
- Modify: `D:\Codes\mushroom\public\index.html`
- Modify: `D:\Codes\mushroom\tests\http\routes.test.ts`

- [ ] **Step 1: 先把 dashboard shell 測試改成新的繁中預期**

```ts
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
```

- [ ] **Step 2: 跑單一測試，確認它先失敗**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run tests/http/routes.test.ts
```

Expected:

```text
FAIL  tests/http/routes.test.ts > serves the dashboard shell
Expected substring: "Android 代理監控台"
```

- [ ] **Step 3: 重組 `public/index.html` 成新的監控台骨架**

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Android 代理監控台</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="shell-backdrop" aria-hidden="true"></div>

    <header class="command-bar">
      <div class="brand-block">
        <p class="eyebrow">Android 流量擷取</p>
        <h1>Android 代理監控台</h1>
        <p class="brand-summary">即時追蹤 Android 裝置經由本機 proxy 的封包活動與節點狀態。</p>
      </div>

      <label class="command-search">
        <span>檢索流量</span>
        <input
          id="session-filter"
          type="search"
          placeholder="依主機、路徑、狀態碼或方法檢索"
        />
      </label>

      <div class="status-strip">
        <div class="status-chip">
          <span class="chip-label">Proxy</span>
          <strong id="proxy-port-chip">--</strong>
        </div>
        <div class="status-chip">
          <span class="chip-label">CA</span>
          <strong id="certificate-status">載入中</strong>
        </div>
        <div class="status-chip">
          <span class="chip-label">Live</span>
          <strong id="live-status">同步中</strong>
        </div>
        <div class="status-chip">
          <span class="chip-label">Sessions</span>
          <strong id="session-count-chip">0</strong>
        </div>
      </div>
    </header>

    <main class="workspace">
      <section class="workspace-panel events-panel">
        <div class="panel-heading">
          <h2>流量事件</h2>
          <p id="session-count">等待載入事件流…</p>
        </div>
        <div id="session-list" class="session-list" aria-live="polite">
          <p class="placeholder">尚未收到任何流量事件。</p>
        </div>
      </section>

      <section class="workspace-panel inspector-panel">
        <div class="panel-stack">
          <section class="panel-block">
            <div class="panel-heading">
              <h2>封包剖析</h2>
              <p>檢視目前選取事件的 request / response 內容。</p>
            </div>
            <div id="session-detail" class="detail">
              <p class="placeholder">選取左側事件後，即可檢視封包內容。</p>
            </div>
          </section>

          <section class="panel-block">
            <div class="panel-heading">
              <h2>節點診斷</h2>
              <p>Proxy、憑證與 Android 設定指引。</p>
            </div>
            <div id="setup-detail" class="detail">
              <p class="placeholder">正在載入節點診斷資訊。</p>
            </div>
          </section>
        </div>
      </section>
    </main>

    <template id="session-item-template">
      <button class="session-item" type="button">
        <span class="method"></span>
        <span class="target"></span>
        <span class="meta"></span>
      </button>
    </template>

    <script type="module" src="/app.js"></script>
  </body>
</html>
```

- [ ] **Step 4: 重新跑 shell 測試，確認骨架已通**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run tests/http/routes.test.ts
```

Expected:

```text
PASS  tests/http/routes.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add public/index.html tests/http/routes.test.ts
git commit -m "feat: add zh-tw dashboard shell"
```

## Task 2: 重做前端渲染與繁中文案

**Files:**
- Modify: `D:\Codes\mushroom\public\app.js`

- [ ] **Step 1: 更新狀態與文案渲染，先讓動態資料對應新骨架**

```js
const elements = {
  filter: document.querySelector("#session-filter"),
  list: document.querySelector("#session-list"),
  count: document.querySelector("#session-count"),
  countChip: document.querySelector("#session-count-chip"),
  detail: document.querySelector("#session-detail"),
  setup: document.querySelector("#setup-detail"),
  liveStatus: document.querySelector("#live-status"),
  proxyPortChip: document.querySelector("#proxy-port-chip"),
  certificateStatus: document.querySelector("#certificate-status"),
  template: document.querySelector("#session-item-template"),
};

function setLiveStatus(label, tone = "online") {
  elements.liveStatus.textContent = label;
  elements.liveStatus.dataset.tone = tone;
}
```

- [ ] **Step 2: 將列表與空狀態文案繁中化，並讓計數同步到 chip**

```js
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

  const countText = `${visibleSessions.length} 筆事件`;
  elements.count.textContent = countText;
  elements.countChip.textContent = String(visibleSessions.length);
  elements.list.innerHTML = "";

  if (visibleSessions.length === 0) {
    elements.list.innerHTML =
      '<p class="placeholder">目前沒有符合條件的流量事件。</p>';
    return;
  }

  for (const session of visibleSessions) {
    const item = elements.template.content.firstElementChild.cloneNode(true);
    item.dataset.sessionId = session.id;
    item.querySelector(".method").textContent = session.method;
    item.querySelector(".target").textContent = `${session.host}${session.path}`;
    item.querySelector(".meta").textContent =
      `${session.scheme.toUpperCase()} · ${session.responseStatus ?? "等待回應"} · ${new Date(session.startedAt).toLocaleString("zh-TW")}`;
    if (session.id === state.selectedId) {
      item.classList.add("active");
    }
    if (session.id === state.flashId) {
      item.classList.add("flash");
    }
    item.addEventListener("click", () => {
      void loadSessionDetail(session.id);
    });
    elements.list.append(item);
  }
}
```

- [ ] **Step 3: 將 detail / setup render 改成繁中監控台語氣**

```js
function renderDetail(session) {
  if (!session) {
    elements.detail.innerHTML =
      '<p class="placeholder">選取左側事件後，即可檢視 request 與 response 的完整內容。</p>';
    return;
  }

  elements.detail.innerHTML = `
    <section>
      <h3>${escapeHtml(session.method)} ${escapeHtml(session.host)}${escapeHtml(session.path)}</h3>
      <p class="summary">
        ${escapeHtml(session.scheme.toUpperCase())} |
        狀態 ${escapeHtml(session.responseStatus ?? "等待回應")} |
        耗時 ${escapeHtml(session.durationMs ?? "N/A")} ms
      </p>
    </section>
    <section>
      <h4>Request Headers</h4>
      ${formatHeaders(session.requestHeaders)}
    </section>
    ${formatPreview("Request Body 預覽", session.requestBodyPreview)}
    <section>
      <h4>Response Headers</h4>
      ${formatHeaders(session.responseHeaders)}
    </section>
    ${formatPreview("Response Body 預覽", session.responseBodyPreview)}
  `;
}

function renderSetup(setup) {
  const certificateText = setup.certificate.exists
    ? `憑證就緒：${setup.certificate.caPath}`
    : "尚未建立 CA 憑證。";

  elements.proxyPortChip.textContent = String(setup.proxyPort);
  elements.certificateStatus.textContent = setup.certificate.exists ? "已就緒" : "未建立";

  elements.setup.innerHTML = `
    <section>
      <h3>Proxy 連接埠</h3>
      <p>${escapeHtml(setup.proxyPort)}</p>
    </section>
    <section>
      <h3>CA 憑證</h3>
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
```

- [ ] **Step 4: 新增 live 狀態與新事件脈衝**

```js
function prependSession(session) {
  const hadSelection = state.selectedId !== null;
  state.flashId = session.id;
  state.sessions = mergeSessions([session], state.sessions);
  renderList();
  window.setTimeout(() => {
    if (state.flashId === session.id) {
      state.flashId = null;
      renderList();
    }
  }, 1200);

  if (!hadSelection) {
    void loadSessionDetail(session.id);
  }
}

function subscribeToEvents() {
  const eventSource = new EventSource("/api/events");
  let initialSyncComplete = false;

  setLiveStatus("同步中", "loading");

  eventSource.addEventListener("open", () => {
    setLiveStatus("即時連線", "online");
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
    setLiveStatus("重新連線中", "warning");
    elements.count.textContent = "即時串流中斷，正在重新連線…";
  };
}
```

- [ ] **Step 5: 跑測試與型別檢查，確認前端字串與 DOM 變更沒有帶壞既有流程**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run tests/http/routes.test.ts tests/server.test.ts
& .\node_modules\.bin\tsc.cmd --noEmit
```

Expected:

```text
PASS  tests/http/routes.test.ts
PASS  tests/server.test.ts
Found 0 errors.
```

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: localize dashboard interactions"
```

## Task 3: 重寫資安終端樣式與動畫

**Files:**
- Modify: `D:\Codes\mushroom\public\styles.css`

- [ ] **Step 1: 建立終端色彩變數、背景層與版面網格**

```css
:root {
  color-scheme: dark;
  --bg: #07111a;
  --bg-2: #0c1824;
  --panel: rgba(8, 20, 31, 0.78);
  --panel-strong: rgba(9, 25, 40, 0.92);
  --border: rgba(92, 211, 255, 0.18);
  --grid: rgba(92, 211, 255, 0.08);
  --text: #d8f3ff;
  --muted: #7ea7bd;
  --accent: #63f3ff;
  --accent-2: #38d9a9;
  --warning: #ffcc66;
  font-family: "Segoe UI", "Noto Sans TC", sans-serif;
  background: var(--bg);
  color: var(--text);
}

body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at top right, rgba(48, 173, 255, 0.16), transparent 28%),
    radial-gradient(circle at bottom left, rgba(52, 255, 192, 0.12), transparent 30%),
    linear-gradient(180deg, #061019 0%, #08131d 100%);
}

.shell-backdrop::before {
  content: "";
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 40px 40px;
  opacity: 0.32;
  pointer-events: none;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(18rem, 24rem) minmax(24rem, 1fr);
  gap: 1rem;
  padding: 0 1.25rem 1.25rem;
}
```

- [ ] **Step 2: 定義 command bar、status chip、events feed 與 panel 語彙**

```css
.command-bar,
.workspace-panel,
.panel-block {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--panel);
  box-shadow:
    inset 0 0 0 1px rgba(120, 227, 255, 0.04),
    0 24px 60px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(14px);
}

.status-chip {
  display: grid;
  gap: 0.18rem;
  min-width: 7rem;
  padding: 0.8rem 0.9rem;
  border: 1px solid rgba(99, 243, 255, 0.14);
  background: rgba(6, 17, 27, 0.72);
}

.session-item {
  display: grid;
  gap: 0.22rem;
  padding: 0.9rem 1rem;
  border: 1px solid rgba(99, 243, 255, 0.12);
  background: linear-gradient(180deg, rgba(8, 22, 34, 0.95), rgba(7, 16, 25, 0.95));
  color: var(--text);
  text-align: left;
}

.session-item.active {
  border-color: rgba(99, 243, 255, 0.75);
  box-shadow: inset 3px 0 0 var(--accent), 0 0 24px rgba(99, 243, 255, 0.12);
}
```

- [ ] **Step 3: 加入克制的監控台動畫與響應式規則**

```css
@keyframes panelEnter {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes sessionPulse {
  0%,
  100% {
    box-shadow: inset 0 0 0 1px rgba(99, 243, 255, 0.14), 0 0 0 rgba(99, 243, 255, 0);
  }
  50% {
    box-shadow: inset 0 0 0 1px rgba(99, 243, 255, 0.4), 0 0 26px rgba(99, 243, 255, 0.18);
  }
}

.command-bar,
.workspace-panel {
  animation: panelEnter 320ms ease-out;
}

.session-item.flash {
  animation: sessionPulse 1.2s ease-out;
}

#live-status[data-tone="online"] {
  color: var(--accent-2);
}

#live-status[data-tone="warning"] {
  color: var(--warning);
}

@media (max-width: 1080px) {
  .workspace {
    grid-template-columns: 1fr;
  }

  .status-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

- [ ] **Step 4: 做手動 UI 驗證，確認版面與動畫符合 spec**

Run:

```powershell
docker compose up --build -d
start http://127.0.0.1:3000
```

Manual checks:

```text
1. 首屏所有主要標題與 placeholder 為繁體中文
2. 頂部狀態列顯示 Proxy / CA / Live / Sessions
3. 左欄為流量事件，右欄為封包剖析與節點診斷
4. 新事件進來時左欄項目會短暫高亮
5. 視窗縮窄後 workspace 會堆疊且不破版
```

- [ ] **Step 5: 跑完整驗證**

Run:

```powershell
& .\node_modules\.bin\vitest.cmd run
& .\node_modules\.bin\tsc.cmd --noEmit
```

Expected:

```text
Test Files  ... passed
Tests       ... passed
Found 0 errors.
```

- [ ] **Step 6: Commit**

```bash
git add public/styles.css
git commit -m "feat: restyle dashboard as cyber terminal"
```

## Task 4: 收尾與交付驗證

**Files:**
- Modify: `D:\Codes\mushroom\public\index.html`
- Modify: `D:\Codes\mushroom\public\app.js`
- Modify: `D:\Codes\mushroom\public\styles.css`
- Modify: `D:\Codes\mushroom\tests\http\routes.test.ts`

- [ ] **Step 1: 檢查最終 diff，確認沒有帶入無關修改**

Run:

```powershell
git diff -- public/index.html public/app.js public/styles.css tests/http/routes.test.ts
```

Expected:

```text
Only frontend shell, copy, style, and shell-test changes appear.
```

- [ ] **Step 2: 再跑一次健康檢查**

Run:

```powershell
try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/health).Content } catch { $_ | Out-String }
```

Expected:

```json
{"ok":true}
```

- [ ] **Step 3: Commit 最終整合**

```bash
git add public/index.html public/app.js public/styles.css tests/http/routes.test.ts
git commit -m "feat: redesign dashboard in zh-tw cyber style"
```

## Self-Review

- Spec coverage:
  - 繁體中文文案：Task 1, Task 2
  - 指揮台版面：Task 1, Task 3
  - live status 與新事件脈衝：Task 2, Task 3
  - 高科技終端樣式：Task 3
  - 測試與手動驗證：Task 1, Task 2, Task 3, Task 4
- Placeholder scan:
  - 無 `TODO`、`TBD` 或「自行補上」類描述
- Type consistency:
  - 新增 DOM ids 與 `elements` 對應一致：`live-status`、`session-count-chip`、`proxy-port-chip`、`certificate-status`
