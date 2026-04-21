# Android Proxy Dashboard

Android Proxy Dashboard 是一個本機除錯工具，用於透過明確設定的 Wi-Fi proxy 檢視 Android 裝置的 HTTP 與 HTTPS 流量。

它包含：

- 用於設定、工作階段瀏覽與即時更新的本機 Fastify web app
- 建立於 `http-mitm-proxy` 之上的 explicit proxy
- 以 SQLite 為後端的工作階段儲存
- request/response body 持久化
- 使用產生出的本機 CA 提供 HTTPS MITM 支援
- 透過 SSE 進行即時工作階段串流的瀏覽器 dashboard

## 功能說明

此應用程式會執行兩個本機服務：

- 預設在 `http://127.0.0.1:3000` 的 `Dashboard`
- 預設在 `0.0.0.0:118080` 的 `Proxy`

Dashboard 預設僅限本機存取。Proxy 預設可從 LAN 存取，讓位於同一個 Wi-Fi 網路上的 Android 裝置能透過你的電腦傳送流量。

完成設定後，你可以：

- 檢視擷取到的工作階段
- 依 host/path 篩選 requests
- 開啟工作階段以檢視 headers 與 body previews
- 下載產生出的 CA certificate
- 驗證 HTTPS 攔截是否已正確設定

## 需求

- 已安裝 Node.js
- 一台與你的電腦位於相同 Wi-Fi 網路上的 Android 裝置
- 若要進行 HTTPS 攔截，需具備在該 Android 裝置上安裝本機 CA certificate 的權限

## 安裝

```bash
npm install
```

## 執行

```bash
npm run dev
```

然後開啟：

- [http://127.0.0.1:3000](http://127.0.0.1:3000)

## Docker

使用 Docker Compose 建置並啟動容器化應用程式：

```bash
docker compose up --build
```

Dashboard 會發布在：

- [http://127.0.0.1:3000](http://127.0.0.1:3000)

在已納入版本控制的 `docker-compose.yml` 中，此應用程式以 `APP_HOST=0.0.0.0` 和連接埠對應 `3000:3000` 執行。這表示 dashboard 可從主機上的 `127.0.0.1:3000` 存取，也可能可由同一網路上的其他裝置透過 `http://your-host-lan-ip:3000` 存取，實際情況取決於你的防火牆與網路政策。

Proxy 會發布在 `118080` 連接埠。設定 Android Wi-Fi proxy 時，請使用主機的 LAN IP 與 proxy port。不要在 Android 裝置上使用 `127.0.0.1`，因為那會指回手機本身，而不是你的電腦。

Docker Compose 會透過命名 volume `app-data`，將持久化應用程式資料掛載到容器內的 `/app/.data`。該持久化資料包含：

- 產生出的 CA 檔案
- `sessions.db`
- 已儲存的 request/response bodies

重新啟動容器時，該 volume 會維持掛載，因此在應用程式重新啟動後，持久化資料仍然可用。使用 `docker compose down` 關閉整個 stack 也會保留該命名 volume，因此資料會為下一次啟動保留。只有在你明確刪除 volume 時，持久化資料才會被移除，例如使用 `docker compose down -v` 或 `docker volume rm`。

## 預設連接埠與主機

預設情況下，應用程式會使用：

- Dashboard host: `127.0.0.1`
- Dashboard port: `3000`
- Proxy host: `0.0.0.0`
- Proxy port: `118080`
- Data directory: `.data`

這表示：

- dashboard 預期在本機上開啟
- proxy 可以透過 LAN 接收來自 Android 裝置的流量

## 環境變數

你可以透過以下環境變數覆寫執行時預設值：

- `APP_HOST`
  - dashboard HTTP listener 的網路綁定位址
  - 預設值：`127.0.0.1`
- `APP_PORT`
  - Dashboard HTTP port
  - 預設值：`3000`
- `PROXY_PORT`
  - 提供給 Android/裝置流量使用的 explicit proxy port
  - 預設值：`118080`
- `PROXY_HOST`
  - proxy listener 的網路綁定位址
  - 預設值：`0.0.0.0`
- `DATA_DIR`
  - 本機狀態的根目錄
  - 預設值：`.data`

範例：

```powershell
$env:APP_HOST="127.0.0.1"
$env:APP_PORT="3100"
$env:PROXY_PORT="8888"
$env:PROXY_HOST="0.0.0.0"
$env:DATA_DIR="D:\temp\android-proxy-dashboard"
npm run dev
```

## 資料配置

在 `DATA_DIR` 內，應用程式會建立：

- `sessions.db`
  - SQLite 工作階段中繼資料
- `certs/`
  - 提供給應用程式使用的 CA certificate 檔案
- `bodies/`
  - 持久化的 request/response bodies
- 由 `http-mitm-proxy` 產生、並與其所需 certificate 目錄結構一起放置的 CA root files

## Android 設定

如果你需要較完整的 Android 憑證安裝、信任設定與 HTTPS 排錯說明，請參考 [Android 憑證安裝與排錯手冊](manual/android-certificate-setup.md)。

### 1. 啟動應用程式

執行：

```bash
npm run dev
```

在桌面瀏覽器中開啟 dashboard：

- [http://127.0.0.1:3000](http://127.0.0.1:3000)

### 2. 找出電腦的 LAN IP

在 Windows PowerShell 中：

```powershell
ipconfig
```

找出 Android 裝置所使用網路對應的 IPv4 位址。

### 3. 設定 Android Wi-Fi proxy

在 Android 裝置上，連線到相同的 Wi-Fi 網路，並手動設定 proxy：

- Host: `your-computer-lan-ip`
- Port: 預設為 `118080`，或你設定的 `PROXY_PORT`

### 4. 開啟 setup endpoints

Dashboard 與 API 會提供：

- `GET /api/setup`
  - 回傳 proxy port、certificate 狀態與 onboarding steps
- `GET /api/certificate`
  - 下載產生出的 CA certificate

你可以使用 dashboard UI，或直接呼叫這些端點：

- [http://127.0.0.1:3000/api/setup](http://127.0.0.1:3000/api/setup)
- [http://127.0.0.1:3000/api/certificate](http://127.0.0.1:3000/api/certificate)

### 5. 為 HTTPS 攔截在 Android 上安裝 CA

如果你想檢視 HTTPS 流量：

1. 從 `/api/certificate` 下載本機 CA
2. 在 Android 裝置上安裝它
3. 依你的 Android 版本與裝置政策信任它

如果沒有該 CA，HTTP 流量仍然可能可用，但 HTTPS 攔截會失敗。

### 6. 啟動目標 app

Android proxy 設定完成後，開啟目標 app 並產生流量。

你應該會在 dashboard 中看到工作階段出現。

## Dashboard 概覽

Dashboard 有三個主要區塊：

### 工作階段列表

顯示擷取到的工作階段，包含：

- method
- host/path
- status
- 基本篩選

### 工作階段詳細內容

當你點擊某個工作階段時，client 會抓取 `/api/sessions/:id` 並渲染已儲存的工作階段詳細內容。

### 設定與診斷

顯示來自 `/api/setup` 的設定狀態，包括 certificate 可用性與 proxy onboarding 提示。

### 即時更新

Dashboard 會訂閱：

- `GET /api/events`

這是一個 `text/event-stream` SSE endpoint，會將新擷取到的工作階段推送到瀏覽器。

## API 端點

### `GET /health`

回傳：

```json
{ "ok": true }
```

### `GET /api/sessions`

回傳擷取到的工作階段清單。

### `GET /api/sessions/:id`

回傳單一擷取到的工作階段；若不存在則回傳 `404`。

### `GET /api/setup`

回傳：

- proxy port
- certificate 狀態
- Android onboarding steps

### `GET /api/certificate`

若可用，下載產生出的 CA certificate。

如果 CA 尚未產生，則回傳 `404`。

### `GET /api/events`

供即時工作階段更新使用的 Server-Sent Events stream。

## 開發指令

安裝相依套件：

```bash
npm install
```

以 watch mode 執行應用程式：

```bash
npm run dev
```

執行測試：

```bash
npm test
```

Type-check：

```bash
npm run build
```

## 架構摘要

高層級元件：

- `src/server.ts`
  - Fastify app bootstrap
  - static assets
  - SSE endpoint
  - 路由註冊
  - 直接執行時的啟動與關閉
- `src/proxy/createProxyServer.ts`
  - explicit proxy 生命週期
  - HTTP 與 HTTPS 擷取
  - body persistence 整合
  - event 發布
- `src/storage/`
  - SQLite 工作階段儲存
  - body persistence
- `src/ca/`
  - CA 狀態檢查與路徑解析
- `src/http/routes/`
  - REST endpoints
- `public/`
  - 瀏覽器 dashboard shell 與 client logic

## 限制

- Dashboard 本身預設僅限本機存取。
- HTTPS 攔截只有在 client 信任產生出的 CA 時才會生效。
- 使用 certificate pinning 或自訂 trust logic 的 app 可能仍然無法被攔截。
- 瀏覽器層級 UI 行為僅有輕量自動化；目前多數驗證仍以 server-side 與 integration-test 為主。
- Graceful shutdown 行為僅有間接覆蓋，尚無專用的 shutdown/in-flight request test。
- 執行時 preview 解碼與獨立的 `decodeBody` utility 高度一致，但在每種情況下並非都透過完全相同的程式路徑驗證。

## 疑難排解

### 看不到任何工作階段

請檢查：

- 應用程式是否正在執行
- Android 裝置與你的電腦是否位於相同 Wi-Fi 網路
- Android Wi-Fi proxy host 是否為你的電腦 LAN IP
- Android Wi-Fi proxy port 是否與 `PROXY_PORT` 一致

### `/api/certificate` 回傳 404

這表示 CA 尚未產生。先觸發 proxy 使用以建立 CA 資料，然後再試一次。

### HTTP 可用，但 HTTPS 不行

請檢查：

- Android 裝置是否信任已下載的 CA
- 目標 app 是否未使用 pinning 或受限的 trust model
- 裝置是否仍在使用已設定的 Wi-Fi proxy

### 有工作階段，但缺少 body previews

可能原因：

- content type 無法預覽
- payload 為 binary
- preview 因設定的限制而被截斷
- 某條 compression/decode 路徑未產生可預覽的文字

### Android 無法連到 proxy

請檢查：

- 你使用的是機器的 LAN IP，而不是 `127.0.0.1`
- 本機防火牆規則允許 proxy port 的傳入流量
- `PROXY_HOST` 未設為僅 loopback 可用

## 測試狀態

此分支目前可通過：

```bash
npm test
npm run build
```

## 後續可改進項目

仍可改進的方向：

- browser-level dashboard integration testing
- 更強的 CA 檔案內容驗證，而不只是檔案存在/版面配置
- 更深入的 graceful-shutdown 驗證
- 更明確的 replay/export 功能
- SSE reconnect UI behavior 的潤飾
