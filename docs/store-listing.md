# Chrome Web Store listing draft

See `docs/policy-baseline.md` for the reviewed official policy sources and remaining publisher requirements.

## Single purpose

Download authorized videos from direct HTTP(S) files or compatible unencrypted fragmented MP4 playback.

## English listing

### Name

Video Downloader

### Short description

Download direct videos or combine compatible MP4 stream parts locally.

### Detailed description

Video Downloader scans the current top-level page when you invoke it and transiently observes media-like requests needed to discover cross-origin playback fragments.

It lists direct MP4, WebM, and similar HTTP(S) video sources and lets you send one to Chrome's download manager.

For compatible unencrypted fragmented MP4 playback, it can fetch the captured initialization and media fragments and remux separate video and audio into one MP4 locally.

Signed and Cookie-protected URLs may work while Chrome can access them normally.

The extension does not parse general HLS or DASH manifests, repair missing or expired fragments, bypass login or paywall restrictions, handle DRM, or send page data to a server.

Download only videos you own or have permission to save.

### Prominent disclosure

The extension locally processes the current page's title, URL, video source information, media request URLs, response media types, and HTTP byte ranges.

Captured request metadata is bounded, retained only in extension memory, and removed after five minutes of inactivity or when the tab closes.

When you select a direct download or MP4 assembly, Chrome sends the required requests to the media's original source websites.

This information is never transmitted to the developer.

### Permission rationale

- `activeTab` temporarily accesses the page where the user invoked the extension.
- `scripting` runs the on-demand read-only video collector in that page.
- `webRequest` and host access observe media request metadata and let the user fetch captured fragments for local assembly.
- `alarms` removes stale in-memory captures.
- `storage` keeps captures in non-persistent session memory across service-worker suspension.
- `downloads` starts the direct or assembled download selected by the user.

## 繁體中文商店資訊

### 名稱

影片下載器

### 簡短說明

下載直接影片，或在本機合併相容的 MP4 串流片段。

### 詳細說明

影片下載器會在您叫用時掃描目前分頁，並暫時觀察媒體請求，以找出跨來源播放器載入的片段。

它會列出直接的 MP4、WebM 與類似 HTTP(S) 影片來源，並將您選擇的檔案交給 Chrome 下載管理器。

對於相容且未加密的 fragmented MP4，它可以在本機抓取已擷取的初始化與媒體片段，並將獨立的視訊與音訊封裝成一個 MP4。

它不會解析一般 HLS 或 DASH manifest、修復遺失或過期片段、繞過登入或付費限制、處理 DRM，或將頁面資料傳送到伺服器。

請只下載您擁有或獲授權保存的影片。

### 顯著揭露

擴充功能會在本機處理目前頁面的標題、網址、影片來源、媒體請求網址、回應類型與 HTTP byte range。

擷取的請求資料有數量限制，只保留在記憶體中，並會在分頁關閉或閒置五分鐘後移除。

當您選擇直接下載或 MP4 組合時，Chrome 會向原始媒體網站送出必要請求。

這些資訊不會傳送給開發者。

### 權限理由

- `activeTab` 會暫時存取使用者叫用擴充功能的頁面。
- `scripting` 會在該頁面執行按需且唯讀的影片收集器。
- `webRequest` 與網站存取權會觀察媒體請求資料，並讓使用者抓取片段在本機組合。
- `alarms` 會移除過期的記憶體內擷取資料。
- `storage` 會讓擷取資料在 service worker 休眠期間保留於非持久性的工作階段記憶體。
- `downloads` 會啟動使用者明確選擇的直接或組合後下載。

## Policy review checklist

- The listing makes one narrow purpose clear.
- The listing never claims support for every site.
- The listing does not mention or target a specific media platform.
- The listing excludes DRM and access-control circumvention.
- The privacy disclosure matches `docs/privacy.md` and the production manifest.
- The final publisher must add support, homepage, and privacy-policy HTTPS URLs.
- Final icons, screenshots, category, and dashboard declarations must match the submitted build.
- The publisher must re-check current Chrome Web Store policies immediately before an authorized submission.
