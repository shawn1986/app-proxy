# Android 憑證安裝與排錯手冊

## 這份文件要解決什麼

這份手冊用來幫你把 Android 裝置接到這個專案提供的 explicit `proxy`，並理解為什麼 `HTTP` 可能可以、`HTTPS` 卻仍然失敗。

它涵蓋：

- Android 裝置如何設 `Wi-Fi proxy`
- 如何透過 `/api/certificate` 下載本機 `CA`
- 如何在 Android 上安裝與信任該 `CA`
- 如何判斷問題是在 proxy 設定、裝置信任、app 信任，還是 `certificate pinning`

這份文件不會繞過 `certificate pinning`，也不會保證所有第三方 app 都能被攔截。

## 前置條件

開始前請先確認：

- 你的電腦與 Android 裝置位於同一個 `Wi-Fi`
- 這個專案已經啟動
- 你知道電腦目前的 `LAN IP`
- 你可以在電腦上打開 dashboard
- 你可以存取：
  - `/api/setup`
  - `/api/certificate`

如果你是用 Docker 執行，請另外確認：

- `docker compose up --build` 已完成
- 主機防火牆沒有擋住 `118080`
- Android 裝置要填的是主機 `LAN IP`，不是 `127.0.0.1`

## 快速成功路線

最短的成功路徑如下：

1. 啟動專案
2. 在 Android 上把目前 `Wi-Fi` 的 `proxy` 改成手動
3. `Host` 填你的電腦 `LAN IP`
4. `Port` 填 `118080`，或你自訂的 `PROXY_PORT`
5. 在電腦打開 `/api/certificate` 下載本機 `CA`
6. 把這個 `CA` 安裝到 Android 裝置
7. 讓 Android 信任該 `CA`
8. 先用瀏覽器或你自己寫的 debug app 驗證
9. 再測試目標 app

如果第 8 步都沒有成功，先不要懷疑目標 app，先檢查 proxy、憑證與裝置信任。

## 在 Android 上設定 Wi-Fi proxy

1. 在 Android 裝置上打開目前連線的 `Wi-Fi`
2. 找到 `Proxy` 或 `進階網路設定`
3. 將 `Proxy` 設為手動
4. 輸入：

- `Host`: `your-computer-lan-ip`
- `Port`: `118080`，或你設定的 `PROXY_PORT`

完成後，Android 的流量就會先送到你的電腦，再由這個專案的 proxy 轉發出去。

如果你完全看不到任何 session，通常先檢查這三件事：

- `Host` 是否填成 `127.0.0.1`
- 電腦與手機是否真的在同一個網段
- 本機防火牆是否擋住 `118080`

## 如何產生並下載本機 CA

這個專案會提供：

- `GET /api/setup`
- `GET /api/certificate`

其中：

- `/api/setup` 用來看目前 setup 狀態、certificate 狀態與 onboarding 提示
- `/api/certificate` 用來下載產生出的本機 `CA`

你可以從 dashboard 打開，也可以直接在瀏覽器開：

- [http://127.0.0.1:3000/api/setup](http://127.0.0.1:3000/api/setup)
- [http://127.0.0.1:3000/api/certificate](http://127.0.0.1:3000/api/certificate)

### 如果 `/api/certificate` 回 `404`

這代表 `CA` 還沒有被產生，不一定是壞掉。

先做這些事：

1. 確認 proxy 已啟動
2. 讓 Android 裝置或其他 client 真的走過一次 proxy
3. 再重新整理 `/api/certificate`

如果仍然是 `404`，再檢查：

- `DATA_DIR` 是否可寫
- 容器或本機程序是否真的啟動成功
- 你看的是否是正確的 dashboard/port

## 如何在 Android 上安裝與信任 CA

不同 Android 版本與品牌介面名稱可能不同，但核心流程通常是：

1. 先把從 `/api/certificate` 下載到的 `CA` 檔帶到 Android 裝置
2. 到 Android 的安全性或憑證設定頁面
3. 找類似以下名稱的入口：

- `從儲存空間安裝`
- `安裝憑證`
- `Install certificate`
- `CA certificate`

4. 選擇剛才下載的 `CA`
5. 完成安裝

部分裝置還會額外要求你：

- 設定螢幕鎖
- 再確認一次要信任使用者安裝的 `CA`

如果系統有明確區分：

- `VPN and apps`
- `Wi-Fi`
- `CA certificate`

優先選能讓 app 流量使用的 `CA` 類型。

### 安裝後要知道的事

Android 裝置「已安裝並信任」這張 `CA`，不代表所有 app 都會接受它。

常見分成兩層：

- 裝置層信任
  - 系統、瀏覽器或部分 app 可能已可使用
- app 層信任
  - 某些 app 不採用系統預設 trust store
  - 某些 app 只信任內建憑證
  - 某些 app 會做 `certificate pinning`

所以你很可能會遇到：

- 手機瀏覽器可以
- 你自己的 debug app 可以
- 某些正式 app 還是不行

這不是代表 proxy 沒工作，而是 app 自己拒絕了這張 `CA`。

## 如何確認是否真的成功

建議按這個順序驗證：

1. 先看 dashboard 有沒有出現 session
2. 再看 `/api/setup` 是否顯示 certificate 狀態正常
3. 再用 Android 瀏覽器測試
4. 最後再測目標 app

你可以這樣判斷：

- `完全沒有 session`
  - 問題通常在 `Wi-Fi proxy`、`LAN IP`、防火牆、網段
- `HTTP 有 session，但 HTTPS 沒成功`
  - 問題通常在 `CA` 安裝或信任
- `瀏覽器成功，但某個 app 失敗`
  - 問題通常在 app 自己的 trust 設計或 `certificate pinning`

## 常見失敗情境

### 1. `/api/certificate` 回 `404`

最常見原因是 `CA` 尚未生成。

處理方式：

1. 先讓流量真的走一次 proxy
2. 再打一次 `/api/certificate`
3. 若仍失敗，檢查啟動狀態與 `DATA_DIR`

### 2. 有裝 CA，但 HTTPS 還是失敗

這代表至少有一層信任沒打通。

先檢查：

- Android 是否真的安裝完成
- Android 是否將它視為可用的 `CA`
- 目前測試的是瀏覽器、你自己的 app，還是第三方正式 app

如果 `HTTP` 正常、`HTTPS` 失敗，通常就是 `CA` 信任鏈的問題，不是 proxy 完全沒工作。

### 3. 手機已信任，但 app 還是不信任

這很常見。

原因通常是：

- app 不使用系統預設 trust store
- app 只接受內建信任鏈
- app 限制使用者安裝的 `CA`

如果你測的是你自己寫的 Android app，debug build 通常比較容易調整成接受這種 `CA`。如果你測的是第三方 app，失敗機率會高很多。

### 4. app 使用 `certificate pinning`

如果 app 使用 `certificate pinning`，即使裝置信任這張 `CA`，它也可能直接拒絕連線。

這種情況常見現象是：

- proxy 有看到連線嘗試
- 但 `HTTPS` request 無法正常完成
- app 端出現 SSL、network security、handshake 類錯誤

這不是靠重新安裝幾次憑證就能解決的事。

### 5. proxy 設好了，但完全沒流量

通常先檢查：

- Android 填的是不是你電腦的 `LAN IP`
- 不是 `127.0.0.1`
- `PROXY_PORT` 是否真的和你啟動的 port 一樣
- 手機和電腦是否在同一個 `Wi-Fi`
- Windows 防火牆是否允許該 port 的傳入流量

如果你是 Docker 模式，也要確認：

- `docker compose up --build` 已成功
- 容器 port mapping 正常
- 主機網路沒有擋 `118080`

### 6. dashboard 看得到 session，但 body 不完整或 HTTPS 還是不穩

這可能不是 proxy 設定錯，而是：

- body 屬於 binary
- preview 被截斷
- 某些 app 自己處理加密或 trust
- 連線中途被 app 拒絕

這時候先不要只盯著 dashboard 畫面本身，要回頭分辨是：

- 傳輸層沒過
- 信任沒過
- 還是 app 邏輯主動擋掉

## 給開發者的提醒

如果你是在測自己寫的 app：

- 先拿 debug build 測
- 先用簡單 API 驗證 proxy 路徑
- 先讓瀏覽器或測試頁通過，再測 app

如果你是在測第三方正式 app：

- 不要預設它一定會信任裝置上的 `CA`
- 不要預設只要安裝憑證就一定能攔截 `HTTPS`
- 要準備接受它因 `certificate pinning` 或自訂 trust model 而失敗

## 最後的判斷順序

當你卡住時，請照這個順序排：

1. proxy 有沒有真的收到流量
2. Android `Wi-Fi proxy` 是否填對 `LAN IP`
3. `/api/certificate` 能不能正常下載
4. Android 有沒有真的安裝並信任 `CA`
5. 瀏覽器能不能先成功
6. 目標 app 是否自己擋掉 `CA`
7. 是否存在 `certificate pinning`

這樣排查，比一開始就懷疑整個工具壞掉有效得多。
