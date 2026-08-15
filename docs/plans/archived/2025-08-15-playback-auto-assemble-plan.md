# Playback Auto-Assemble Plan

## Goal

自動偵測影片播放結束時機，顯示片段擷取進度，並引導使用者將所有已擷取的 MP4 片段合併為完整的影片檔案。

## Context

目前的擴充功能在 Background 透過 `chrome.webRequest` 即時記錄影片片段，並在 Popup 提供手動「Assemble MP4」按鈕。使用者必須在播放期間或播放後自行觸發合併，且缺乏進度回饋，導致：

- 片段擷取不完整（提早合併）
- 使用者不知道正在發生什麼事
- 分段串流（fragmented MP4 / CMAF）體驗不流暢

## Architecture

`src/content/playback-monitor.ts` 在最上層頁面監聽有界限且不含來源 URL 的 HTML video 時間狀態。

Background 以分頁為單位將最新狀態保存在 `chrome.storage.session`，並用 one-shot `chrome.alarms` 實作可跨 service-worker 休眠的三秒 grace period。

Alarm 完成後，Background 重新讀取 MP4 片段與必要的 `playlist.json` 初始化 metadata，保存 `assemblyReady`，並用 `chrome.runtime.sendMessage` 通知仍開啟的 Popup。

Popup 關閉時訊息可能無接收者，因此重新開啟 Popup 時會從 session state 恢復播放完成與 assembly-ready 狀態。

## Plan

### Phase 1：播放進度監控

- [x] 建立 `src/content/playback-monitor.ts`，監聽既有與動態 `<video>` 的 `timeupdate`、`play`、`durationchange`、`ended`、`error`，限制更新頻率且不傳來源 URL；證據：`tests/content/playback-monitor.test.ts`。
- [x] 在 `src/manifest.json` 註冊 top-frame、`document_start`、`<all_urls>` content script；證據：production build 產生 `content_scripts/content-0.js`。
- [x] 驗證 Content → Background 的 `playbackState` 與 `videoEnded` 鏈路；證據：Playwright `captured-stream.html` fixture 觸發三秒後的 ready 狀態。

### Phase 2：Background 自動觸發

- [x] 在 `src/background/index.ts` 路由並驗證 `videoEnded` 與 `playbackState`，僅接受具有有效 `sender.tab.id` 的有界限狀態。
- [x] 以 one-shot alarm 實作三秒等待，刷新 video/audio MP4 片段與組合所需的 playlist metadata，保存狀態並發送 `triggerAssembly`。
- [x] 在 navigation、tab close、新播放與五分鐘 cleanup 時清理 playback state 或 stale alarm。
- [x] 驗證播放結束後 Popup 收到刷新片段並顯示 ready；證據：`npm run test:e2e:built` 的 fragmented MP4 測試通過。

### Phase 3：Popup 進度狀態

- [x] 在 `src/popup/state.ts` 新增 `assembly: AssemblyView`，支援 `idle`、`fetching`、`muxing`、`accepted`、`error`。
- [x] 新增 `playbackProgress: PlaybackProgress | null` 與解析邊界，記錄時間、播放、完成、ready 與 timestamp 狀態。
- [x] 新增 reducer actions，並限定 ready 訊息只能更新目前掃描中的 tab。
- [x] 在 `src/popup/App.tsx` 註冊並於 unmount 移除 runtime listener，處理 `playbackProgress` 與 `triggerAssembly`。
- [x] 驗證狀態轉換與最新片段取代；證據：`tests/popup/state.test.ts`、`tests/popup/App.test.tsx`、`tests/platform/chrome-tabs.test.ts`。

### Phase 4：UI 進度顯示

- [x] 在 `src/popup/messages.ts` 新增播放完成、ready action、fetching、muxing 與播放進度的 `en`、`zh-TW` 字串。
- [x] 在 `src/popup/App.tsx` 顯示可存取的播放、片段下載與 muxing progressbar，並在 grace period 完成後將 action 更新為「合併完整影片」。
- [x] 在 `src/popup/styles.css` 加入 light、dark 與 reduced-motion 進度樣式。
- [x] 驗證 UI 進度、最新片段與 ready action；證據：Popup component test 與 Chromium E2E 通過。

### Phase 5：文件與發布防護

- [x] 更新 README、privacy、store listing、support matrix、policy baseline 與 release audit，揭露 top-frame playback monitor 與 session retention。
- [x] 更新 `scripts/audit-artifact.mjs`，要求 production artifact 只能包含預期的 playback content script。
- [x] 新增 component、boundary、content-script 與 E2E regression coverage，且不使用外部媒體或網路來源。

## Non-Goals

- 不改變 `src/core/assemble-captured-mp4.ts` 的合併核心邏輯（decodeTime 排序、片段去重、blob 合成已成熟）。
- 不支援非 fragmented MP4（如完整 single-file MP4 下載）的自動分段。
- 不實作「播放後自動開始合併」的免使用者確認模式；最終合併仍需使用者點擊按鈕。
- 不處理 HLS / DASH manifest 解碼與重新封裝（已屬 `src/local/segment-merger.ts` 的 CLI 領域）。
- 不處理 live 串流（YouTube live 等持續產生新片段的場景）。

## Assumptions

- 目標頁面的 `<video>` 元素支援標準 HTML5 Media Events（`timeupdate`、`ended`）。
- Popup 可能在播放期間關閉，因此 Background session state 是恢復來源，runtime 訊息只負責即時更新。
- `chrome.storage.session` 中的 capture 與 playback state 在頁面未重新整理且未逾時前保持完整。

## Unknowns

- 部分網站使用 `<video>` 的 `srcObject`（MediaStream API），此類影片無法透過 `currentSrc` 取得 URL；`playback-monitor.ts` 仍會回報 `timeupdate` 但無法關聯到 `capturedVideosByTab` 中的具體片段。此為已知限制，不影響整體方案。

## Risks

| 風險 | 影響 | 緩和措施 |
|------|------|----------|
| Popup 未開啟 | runtime 通知無接收者 | Background 保存 ready 與最新片段；重新開啟 Popup 可從 session state 恢復 |
| 影片有廣告片頭 | 任一 `ended` 都可能暫時標示 ready | 新的 playback event 會取消 alarm 或清除 ready；多影片的精確媒體關聯仍列為限制 |
| 未知或 live duration | 無法計算百分比 | 不顯示誤導性的 determinate playback bar，但仍處理標準 `ended` 狀態 |
| Content script 擴大執行面 | 商店揭露與 lifecycle 風險 | 僅 top frame、無 URL、500ms 節流、有界限驗證、五分鐘 session cleanup，並由 artifact audit 鎖定宣告 |

## Rollback / Recovery

- 本方案新增獨立的 `playbackByTab` session key；無 migration 或持久資料，回滾時可直接停止讀寫並由 session 結束清除。
- 移除 playback monitor、manifest 宣告、Background playback/alarm 路由與 Popup progress state 即可回滾。
- 現有手動合併流程保持可用；ready action 只在標準 `ended` 與三秒 grace period 完成後取代按鈕文字。

## Completion Checklist

- [x] `npm run build:chrome` 成功產生 `dist/chrome/` 與 `video-downloader-0.1.0.zip`。
- [x] Chromium extension E2E 驗證 `<video>` completion 訊息經 Background alarm 更新 Popup ready 狀態。
- [x] Component 與 Chromium E2E 驗證 fetching progress、完整片段刷新、mux/download accepted 與可播放的 audio+video MP4。
- [x] `npm test` 通過 12 個 test files、154 個 tests。
- [x] `npm run ci` 完整通過 check、unit/component、typecheck、FFmpeg integration、dependency audit、build、10 個 E2E 與 artifact audit；Biome 僅回報使用者既存未追蹤 `scripts/download-izaax.mjs` 的非阻擋 info。
