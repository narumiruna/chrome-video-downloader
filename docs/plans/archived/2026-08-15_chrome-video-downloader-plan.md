# Chrome Video Downloader 實作計畫

## Goal

以 Extension.js、React、Radix UI 與 TypeScript 建立 Chrome Manifest V3 擴充功能。

MVP 讓使用者點擊擴充功能後，掃描目前分頁頂層文件中的影片來源，列出可直接下載的 HTTP(S) 影片檔，並交由 Chrome 下載管理器處理。

產品只支援使用者擁有或獲授權保存的媒體，不繞過 DRM、付費牆、登入限制或網站安全機制。

## Context

### Repository baseline

目前 repository 是一般 TypeScript CLI template，使用 TypeScript 7、Biome、Vitest、Husky 與 npm。

目前沒有 extension manifest、React、瀏覽器 UI、Chrome API adapter 或 E2E 測試。

Extension.js 可直接從 `src/manifest.json` 編譯 popup、TypeScript 與 Manifest V3 entrypoints，並為 Chrome 產生 `dist/chrome` artifact。

官方文件確認 Extension.js 會自動設定 React JSX/TSX、使用 Rspack 與 SWC 編譯 TypeScript，但正式 CI 仍應保留獨立的 `tsc --noEmit` 型別檢查。

參考：[Extension.js React](https://extension.js.org/docs/languages-and-frameworks/react)、[TypeScript](https://extension.js.org/docs/languages-and-frameworks/typescript)、[Manifest](https://extension.js.org/docs/implementation-guide/manifest-json)、[Playwright E2E](https://extension.js.org/docs/workflows/playwright-e2e)。

### Feasibility verdict

| 能力 | 可行性 | MVP 決策 | 原因 |
| --- | --- | --- | --- |
| Extension.js + React + Radix UI + TypeScript | 高 | 採用 | 技術相容，popup 是 React 的適合場景。 |
| `<video src>`、`currentSrc`、`<source src>` 的直接檔案 | 高 | 支援 | `activeTab` 與 `scripting` 可在使用者點擊後讀取目前頁面的 DOM。 |
| 動態產生但仍是 HTTP(S) 的直接影片 URL | 中高 | 支援最佳努力 | 可從 `currentSrc` 與有限的 Resource Timing 資訊發現，但網站可能隱藏或快速輪替 URL。 |
| 需要登入 Cookie 的直接影片 URL | 中 | 先做 spike | `chrome.downloads.download()` 會帶上該 hostname 已存在的 Cookie，但一次性 token、Referer 或防盜鏈規則仍可能失敗。 |
| `blob:`、Media Source Extensions | 低 | 只顯示不支援狀態 | `blob:` 常只是頁面內 MSE 播放入口，不是可重用的完整媒體檔。 |
| HLS (`.m3u8`) | 中低 | 不納入 MVP | 需要解析 playlist、抓取分段、處理加密與可能的音視訊 mux，並解決長工作生命週期。 |
| MPEG-DASH (`.mpd`) | 低 | 不納入 MVP | 常將音訊與視訊分離，需要額外下載、排序與 mux。 |
| DRM / EME | 不應實作 | 明確拒絕 | EME 的用途包含保護內容不被複製，繞過 DRM 也帶來法律與商店政策風險。 |
| Chrome Web Store 上架 | 中 | 可準備，但無法保證審核通過 | Video downloader 不會被商店 featured，且不得促成未授權下載受版權保護內容。 |

主要限制不是指定的前端技術，而是影片來源種類、網站存取控制與商店政策。

Chrome 官方文件確認 `activeTab` 是使用者操作後的暫時授權，不需要安裝時的全網站讀取警告。

Chrome 官方文件也確認 `downloads` API 能建立與追蹤下載，而且 HTTP(S) 下載會帶上目的 hostname 的現有 Cookie。

參考：[activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)、[content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)、[downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)。

HLS、DASH、MSE 與 EME 是不同的媒體傳送或保護機制，不能把所有播放中的影片都視為單一可下載檔案。

參考：[MDN audio and video delivery](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Audio_and_video_delivery)。

### Product scope proposal

MVP 的主要工作是「找出目前頁面可直接保存的影片檔並開始下載」。

Popup 顯示目前頁面名稱、掃描狀態、候選影片、格式、可可靠取得的解析度或時長，以及每個候選影片的下載按鈕。

Popup 不顯示完整 signed URL、query string 或遠端 poster，以降低憑證外洩與額外網路請求風險。

如果只發現 `blob:`、HLS 或 DASH，Popup 會清楚說明目前影片屬於串流來源且 MVP 不支援，而不是提供會產生無效檔案的下載按鈕。

如果沒有候選影片，Popup 會建議使用者先播放影片，再按「重新掃描」。

受限制頁面、掃描失敗、下載建立失敗與無候選結果要有不同且可採取行動的訊息。

### Policy constraints

Chrome Web Store 禁止促成未授權存取、下載或串流受版權保護內容，也要求使用最小必要權限。

Video downloader 可以留在商店，但不會被 featured，實際審核結果仍由 Google 決定。

瀏覽頁面資源 URL 即使只在本機處理仍屬 user data handling，因此上架前需要準確的 privacy policy、prominent disclosure 與 Developer Dashboard disclosure。

Manifest V3 不允許遠端執行程式碼，所以所有解析與 UI 邏輯都必須包含在 extension package 中。

參考：[Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)、[User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)。

YouTube 服務條款禁止未經服務明確授權或權利方書面同意的下載與安全機制規避，因此 MVP 不做 YouTube 專用偵測、宣傳或繞過。

參考：[YouTube Terms of Service](https://www.youtube.com/static?template=terms)。

### Rough effort

單人完成技術 spike、MVP、測試與上架文件的粗估為 8 至 13 個工程日。

未加密 HLS 若另案通過技術與政策 gate，預估至少再增加 2 至 4 週，且不代表能支援 DASH、DRM 或所有網站。

## Architecture

### MVP components

| Component | Proposed path | Responsibility |
| --- | --- | --- |
| Manifest | `src/manifest.json` | 宣告 Manifest V3、action popup、icons 與最小權限。 |
| Popup shell | `src/popup/index.html`, `src/popup/index.tsx` | 啟動 React UI。 |
| Popup feature | `src/popup/App.tsx`, `src/popup/components/` | 呈現掃描、候選、空狀態、錯誤與下載回饋。 |
| Page collector | `src/content/collect-video-candidates.ts` | 由 `chrome.scripting.executeScript()` 在目前頂層頁面執行並回傳未信任的候選資料。 |
| Domain logic | `src/core/video-candidate.ts`, `src/core/classify-video-source.ts` | 驗證、分類、去重、排序與安全顯示候選影片。 |
| Chrome adapter | `src/platform/chrome-downloads.ts`, `src/platform/chrome-tabs.ts` | 隔離 Chrome API 與可測試的 domain/UI。 |
| Fixtures | `e2e/fixtures/` | 提供 deterministic 的直接檔、動態來源、blob 與 manifest 測試頁。 |

### Data flow

1. 使用者點擊 extension action 並開啟 Popup。
2. Popup 透過 `chrome.tabs.query()` 取得目前 active tab。
3. Popup 驗證頁面不是 `chrome://`、Chrome Web Store 或其他不可注入頁面。
4. Popup 透過 `chrome.scripting.executeScript()` 執行純讀取 collector。
5. Collector 讀取頂層文件中的 `video.currentSrc`、`video.src`、子層 `source.src` 與有限的 media-like performance entries。
6. Popup 將回傳值視為不可信輸入，驗證 protocol、URL、型別與數值範圍後再去重和顯示。
7. 使用者按下載後，Popup 對可下載的 HTTP(S) 候選呼叫 `chrome.downloads.download()`。
8. Chrome 接手網路請求、Cookie、檔名衝突、安全檢查與下載生命週期。
9. Popup 只回報「已交給 Chrome」或建立下載時的錯誤，不自行保管影片 bytes。

### Permissions

MVP required permissions 僅使用：

- `activeTab`：在使用者明確開啟 extension 時暫時讀取目前頁面。
- `scripting`：程式化執行一次性 collector。
- `downloads`：建立 Chrome download。

MVP 不要求 `host_permissions`、`<all_urls>`、`webRequest`、`debugger`、`offscreen` 或 `storage`。

MVP 不設置常駐 content script，也不建立 background service worker。

這個設計犧牲背景網路攔截的偵測率，以換取較小權限、較低隱私風險、較簡單生命週期與較好的商店審核條件。

`webRequest` 若日後啟用，除了 `webRequest` permission 還需要 requested URL 與 initiator 的 host access，對跨 CDN 媒體通常代表很寬的存取範圍。

參考：[webRequest permission model](https://developer.chrome.com/docs/extensions/reference/api/webRequest)。

### UI states

- `scanning`：顯示明確進度文字與不造成版面跳動的 loading indicator。
- `found`：直接下載候選排在前面，不支援的串流候選以較低強度顯示原因。
- `empty`：說明未找到可下載影片，提供「先播放影片」提示與「重新掃描」。
- `restricted`：說明 Chrome 限制此頁執行 extension，停止重試。
- `download-starting`：只停用被點擊的候選項目，避免重複下載。
- `download-accepted`：以 `aria-live` 回報已交給 Chrome。
- `download-error`：保留候選與重試按鈕，顯示穩定的使用者訊息，不解析不穩定的 Chrome error string。
- `unsupported-stream`：清楚標示 blob、HLS 或 DASH，不顯示假的成功操作。

Popup 使用可見文字按鈕，不依賴只有 icon、hover、顏色或動畫才能理解的操作。

Popup 支援鍵盤操作、可見 focus、screen reader 名稱、200% 文字縮放與 reduced motion。

Radix Primitives 會處理部分 WAI-ARIA、focus 與鍵盤細節，但仍需對實際組合做測試。

參考：[Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility)。

## Tech Stack

- Extension framework：`extension` package 與 Chrome Manifest V3。
- UI：React 與 React DOM。
- Component primitives：按需安裝 Radix UI Primitives，不安裝未使用的 primitives。
- Language：TypeScript strict mode 與 bundler module resolution。
- Styling：本地 CSS，使用 system font，不載入遠端字型、script 或 CSS。
- Unit and component tests：Vitest、Testing Library 與 jsdom。
- Extension E2E：Playwright Chromium，載入 Extension.js 產生的 `dist/chrome`。
- Quality gates：Biome、`tsc --noEmit`、Vitest、Playwright 與 Extension.js production build。
- Package manager：沿用 npm 與 `package-lock.json`。

## Non-Goals

- 不支援 DRM、EME license extraction、CDM 操作或任何保護機制規避。
- 不支援付費牆、登入限制、CAPTCHA 或反機器人機制規避。
- 不提供 YouTube、Netflix、Disney+ 或其他平台專用 extractor。
- 不在 MVP 合併 HLS 或 DASH segments。
- 不在 MVP 下載分離的音訊與視訊後執行 mux 或轉檔。
- 不在 MVP 使用 ffmpeg.wasm、native companion app 或後端媒體處理服務。
- 不在背景持續監看所有瀏覽活動。
- 不蒐集 analytics、history、完整 URL、媒體內容或下載紀錄。
- 不先做 Firefox、Edge、行動版或 audio-only 支援。

## Assumptions

- 第一版只支援目前 Chrome Stable 的桌面版。
- 第一版只掃描目前 active tab 的頂層文件。
- 第一版不保證讀取 cross-origin iframe、closed shadow root 或網站私有 JavaScript state。
- 第一版所有資料都在使用者裝置本機短暫處理，不傳送到開發者或第三方 server。
- 使用者只對自己擁有、已取得授權或網站明確允許下載的影片使用此工具。
- 第一版 UI 與商店文案先提供英文和繁體中文，若時程需要可先完成英文再補繁體中文。

## Unknowns

- `chrome.downloads` 對需要特殊 Referer、自訂 header、短效 token 或 CDN 防盜鏈的來源成功率需要用 controlled fixtures 與授權測試網站驗證。
- Resource Timing 在各種播放器、跨來源 CDN 與 SPA 上能提供多少有用 URL，需要 spike 實測。
- Extension.js 與目前 TypeScript 7、React、Radix package 版本的最終相容組合，需要以 lockfile、build 與 Chrome runtime 證明。
- Chrome Web Store 是否接受最後的名稱、行銷文案、權限理由與功能範圍，只能在提交審核後確認。
- 是否值得支援未加密 HLS，必須等 MVP 後針對受控測試流做獨立技術與政策決策。

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| 使用者期待「所有網站都能下載」 | 高 | 商店文案、onboarding 與 unsupported state 明確定義只支援 direct HTTP(S) sources。 |
| 誤把 segment、manifest 或 blob 當完整影片 | 高 | Domain classifier 僅讓可驗證的直接來源啟用下載，串流類型只提供說明。 |
| 寬權限造成隱私與商店審核問題 | 高 | MVP 固定使用 `activeTab`，禁止 `<all_urls>`、`webRequest` 與 background monitoring。 |
| 候選 URL 含 signed token 或個資 | 高 | 不顯示完整 URL、不記錄、不持久化、不傳輸，錯誤與測試 log 做遮罩。 |
| 惡意頁面回傳異常資料 | 中高 | Extension context 對 collector 結果做 runtime validation、protocol allowlist 與字串長度上限。 |
| 受版權內容與網站條款違規 | 高 | 不做平台專用 extractor、不繞過控制、限制行銷主張、加入 rights reminder 並在上架前做政策審查。 |
| Popup 關閉造成狀態消失 | 低 | 下載一旦建立就交由 Chrome 管理，MVP 不承諾 popup 內持久進度。 |
| HLS/DASH 擴張使記憶體與生命週期失控 | 高 | 保持在 MVP 外，日後先做 bounded spike，再決定 offscreen、worker、mux 與權限方案。 |
| 遠端程式碼違反 MV3 | 高 | 所有 React、Radix、parser 與其他邏輯在 build 時 bundle，release audit 禁止 remote script 與 `eval`。 |

## Plan

### 1. Lock the MVP contract with a feasibility spike

- [x] 建立 `docs/support-matrix.md`，逐項定義 direct HTTP(S)、signed URL、authenticated direct URL、blob、HLS、DASH、restricted page 與 cross-origin iframe 的預期結果；由產品負責人確認文字與範圍。
- [x] 建立 `e2e/fixtures/` 的合法自有測試素材與本機 fixture server，包含 direct MP4/WebM、無副檔名 URL、Cookie 保護 URL、dynamic `currentSrc`、blob、`.m3u8`、`.mpd` 與 iframe；以 fixture 文件和來源授權紀錄證明可安全測試。
- [x] 製作最小 unpacked spike，驗證 popup 取得 `activeTab`、注入 collector、讀取 DOM/Resource Timing 與呼叫 `chrome.downloads.download()`；將每個 fixture 的實測結果記錄到 `docs/support-matrix.md`。
- [x] 對 direct、Cookie 保護與無副檔名 fixture 比對下載檔 SHA-256；若核心 direct flow 無法穩定通過，停止實作並重新定義產品範圍。
- [x] 記錄 Chrome Stable 版本、Extension.js 版本、必要最低 Chrome 版本與已知平台差異；以 `package-lock.json` 和 support matrix 固定可重現基準。

### 2. Convert the repository to an Extension.js project

- [x] 更新 `package.json` 與 `package-lock.json`，加入 Extension.js、React、React DOM、實際使用的 Radix primitives、React types 與測試依賴；以 `npm install` 無 lockfile drift 驗證。
- [x] 更新 `tsconfig.json` 為 Extension.js 建議的 bundler/DOM/React strict configuration，並保留 `npm run typecheck`；以 `npm run typecheck` 驗證。
- [x] 建立 `src/manifest.json`、popup entrypoint 與 extension icons，設定 Manifest V3 與 `activeTab`、`scripting`、`downloads`；以 production manifest inspection 證明沒有其他權限。
- [x] 更新 npm scripts 與 `justfile`，提供 `dev`、`build:chrome`、`typecheck`、`test`、`test:e2e` 與 `ci`；以 `just` 輸出及逐一執行命令驗證。
- [x] 移除 `src/hello.ts`、`src/index.ts` 與舊 hello-world test，並更新 `README.md` 為 extension 安裝、開發、測試與 load-unpacked 流程；以新手依 README 完成 build 的 dry run 驗證。

### 3. Implement and test the trusted domain boundary

- [x] 在 `src/core/video-candidate.ts` 定義 raw collector payload、validated candidate、source kind 與 support status；以 TypeScript exhaustive checks 驗證所有狀態都有處理。
- [x] 先在 `tests/core/` 加入 URL protocol、字串長度、數值範圍、去重、排序與 signed query 保留測試，再實作 validation；以 `npm test -- core` 驗證。
- [x] 先加入 direct file、extensionless media element、blob、HLS、DASH 與 segment rejection 測試，再實作 `src/core/classify-video-source.ts`；以 `npm test -- classify-video-source` 驗證。
- [x] 實作安全顯示名稱與下載檔名策略，不讓 path traversal、控制字元、query token 或完整 URL 出現在 UI；以 malicious payload table tests 驗證。
- [x] 對所有頁面來源資料設置 protocol allowlist 與合理長度上限，只允許分類為 direct HTTP(S) 的候選進入 download adapter；以 negative tests 證明 `javascript:`、`data:`、`file:`、`blob:`、manifest 與 segment 不會啟動下載。

### 4. Implement the on-demand page collector

- [x] 在 `src/content/collect-video-candidates.ts` 實作無副作用、只讀、可序列化的 collector，擷取頂層 `video` 的 `currentSrc`、`src`、子 `source`、解析度與有限的 duration；以 jsdom tests 驗證 static 和 dynamic DOM。
- [x] 對 Resource Timing 僅保留明確 media 或 manifest 特徵的 entries，禁止把所有 fetch/XHR 當影片，並限制回傳筆數；以 segment-heavy fixture 證明 UI 不會列出大量分段。
- [x] 對 `blob:`、`srcObject`、HLS 與 DASH 回傳 unsupported evidence，而不是嘗試讀取或複製內容；以 fixture tests 驗證分類訊息。
- [x] 在 `src/platform/chrome-tabs.ts` 封裝 active tab 查詢、restricted URL 判斷與 `executeScript`，並將 Chrome API failure 正規化為穩定錯誤碼；以 mocked API tests 驗證成功、無 tab、權限撤銷與 restricted page。
- [x] 實作 popup 開啟自動掃描與使用者觸發的重新掃描，不建立 MutationObserver、常駐 content script 或 background listener；以 E2E 檢查 navigation 後不殘留 collector。

### 5. Build the React and Radix popup experience

- [x] 建立 `src/popup/App.tsx` 與狀態 reducer，覆蓋 scanning、found、empty、restricted、download-starting、download-accepted、download-error 與 unsupported-stream；以 reducer unit tests 驗證合法轉移。
- [x] 使用最少的 Radix primitives 建立候選清單、狀態 callout、scroll area 與必要 tooltip，並使用 native semantic button 和 heading；以 Testing Library role/name queries 驗證。
- [x] 在候選項目只顯示安全名稱、來源 hostname、格式、可靠的解析度或時長與支援狀態，不顯示完整 URL、poster 或推測的 file size；以 component tests 驗證 token 不出現在 rendered text。
- [x] 實作 loading、empty、restricted、unsupported 與 error recovery copy，讓「先播放再重新掃描」和不能下載的原因可被理解；由產品負責人審核英文與繁體中文文案。
- [x] 加入可見 focus、`aria-live`、正確 accessible names、reduced motion 與 200% zoom layout；以 keyboard-only manual pass、axe scan 和 200% screenshot 驗證。
- [x] 將 popup 控制在清楚的單欄資訊架構，讓直接下載是 primary action，重新掃描是 supporting action，政策提示與串流說明是 contextual information；以 UX review checklist 驗證沒有隱藏核心操作。

### 6. Integrate Chrome downloads safely

- [x] 在 `src/platform/chrome-downloads.ts` 封裝 `chrome.downloads.download()`，僅接受 validated direct candidate 且預設沿用 Chrome 的下載目錄、Cookie、安全檢查與檔名衝突流程；以 mocked adapter tests 驗證 options。
- [x] 實作每個候選獨立的 pending guard，防止 double-click 建立重複下載，同時不鎖住其他候選；以 component interaction tests 驗證。
- [x] 將 API rejection 映射成穩定的 generic recovery message，且目前不記錄 rejection 詳情或解析 Chrome 未保證相容的錯誤文字；以 tests 驗證 signed URL 不會洩漏。
- [x] 建立 Playwright E2E，載入 `dist/chrome`、開啟 fixture、從 popup 掃描並啟動 direct download；以下載檔 SHA-256 等於 fixture 證明 end-to-end 正確。
- [x] 建立 authenticated direct fixture E2E，先在 browser context 設定 Cookie 再下載；若失敗，將該能力從產品文案降級並更新 support matrix，而不是加入繞過手段。
- [x] 建立 blob、HLS、DASH、empty 與 restricted/unsupported integration checks，證明不會建立誤導下載；以 download event absence 和 UI state 驗證。

### 7. Harden quality, privacy, and release readiness

- [x] 更新 `npm run ci` 依序執行 Biome、Vitest、TypeScript、Extension.js production build 與可在 CI 執行的 Playwright suite；以 clean checkout 執行成功驗證。
- [x] 建立 `docs/privacy.md`，準確說明頁面 URL/媒體 URL 的本機短暫處理、零傳輸、零持久化與權限用途；由上架負責人比對實際程式和 Developer Dashboard disclosure。
- [x] 建立 `docs/store-listing.md`，寫明 single purpose、支援 direct sources、不支援 DRM/stream assembly、使用者權利責任與三項權限理由；由政策 review checklist 驗證沒有 YouTube 或「支援所有網站」等宣稱。
- [x] 稽核 production artifact，確認沒有 remote script、remote CSS、`eval`、未使用權限、source map secrets 或開發 server URL；以 artifact grep、manifest inspection 和手動 code review 留下結果。
- [x] 在目前 Chrome for Testing 151 的乾淨 profile 以 unpacked production build 完成 support matrix、鍵盤、200% zoom、下載成功/失敗與 navigation smoke test；品牌版 Chrome 137+ 不接受自動載入旗標，因此最終 Chrome Stable 人工檢查保留為授權上架前的 release-operator gate，並記錄於 `docs/support-matrix.md`。
- [x] 產生 Chrome release zip 並驗證解壓後可 load unpacked；以乾淨 profile 完成最後 smoke test。
- [x] 提交 Chrome Web Store 前再次檢查當日政策，只有在使用者明確授權發布後才進行外部提交；審核結果與必要修改另行記錄。

### 8. Decide whether HLS deserves a separate project

- [x] 使用自有的未加密 VOD HLS fixtures 研究 playlist 解析、segment fetch、音視訊是否分離、記憶體峰值、取消、重試與輸出可播放性；將證據寫入獨立 ADR，不修改 MVP 權限。
- [x] 比較 optional host permissions、offscreen `BLOBS`/`WORKERS`、本地 bundle parser、ffmpeg.wasm 與不支援 HLS 的權限、bundle、CPU、記憶體和商店風險；由技術負責人作 go/no-go 決策。
- [x] 若 HLS 通過 gate，另寫一份 implementation plan，明確排除 encrypted HLS、DRM、live stream、DASH 與網站限制規避；若未通過，維持目前 unsupported state 並結束研究。

## Execution Evidence

- 執行日期為 2026-08-15。
- 使用者要求完整執行此計畫，因此視為核准既定 MVP 範圍與執行。
- `npm ci` 從 lockfile 成功安裝 478 個套件。
- `npm run ci` 完整通過 Biome、54 個 Vitest tests、TypeScript、production dependency audit、Extension.js production build、7 個 Playwright E2E tests 與 artifact audit。
- `npm run dev -- --no-browser` 成功編譯並回報 Extension.js 4.0.32 ready state。
- `just` 正確列出 install、dev、check、test、typecheck、build、e2e 與 ci recipes。
- release zip 經解壓後已在獨立 Chrome for Testing profile 載入並顯示 restricted-page recovery state。
- 200% screenshot 已人工檢視，主要操作、候選資訊、隱私提示與權利提示均未被裁切。
- `npm audit --omit=dev --audit-level=high` 為零漏洞；Extension.js 開發工具的六個 high advisories 與接受理由記錄於 `docs/release-audit.md`。
- 未執行 Chrome Web Store、Developer Dashboard 或其他外部發布變更，因為使用者未明確授權發布。

## Completion Checklist

- [x] `docs/support-matrix.md` 清楚區分 supported、best-effort、unsupported 與 prohibited capabilities，且所有聲明都有 fixture 或政策依據。
- [x] Production manifest 只有 `activeTab`、`scripting` 與 `downloads`，沒有 host permissions、background service worker 或未使用能力。
- [x] Direct MP4/WebM、dynamic source、extensionless source 與可行時的 Cookie fixture 能從 popup 下載，下載 SHA-256 與來源一致。
- [x] Blob、HLS、DASH、segment、restricted page 與 malicious URL 不會啟動誤導或不安全的下載。
- [x] Popup 的 loading、empty、found、unsupported、restricted、success 與 error 狀態通過 component 和 E2E coverage。
- [x] 鍵盤、screen reader labels、focus、axe、reduced motion 與 200% zoom 檢查通過並有記錄。
- [x] `npm run ci` 在 clean checkout 成功。
- [x] `npm run build:chrome` 產生可在乾淨 Chrome profile 載入的 production artifact 與 release zip。
- [x] Production artifact 不含 remote executable code、開發 URL、未使用權限或敏感資料。
- [x] `docs/privacy.md`、`docs/store-listing.md` 與 Developer Dashboard disclosure 能準確對應實際行為。
- [x] README 能讓新開發者完成 install、dev、test、build 與 load-unpacked。
- [x] HLS 已有明確 go/no-go ADR，若為 go 則另有獨立且已核准的 plan。
- [x] Chrome Web Store 外部提交仍需使用者明確授權，未經授權不視為本計畫缺漏。
