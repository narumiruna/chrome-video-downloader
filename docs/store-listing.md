# Chrome Web Store listing draft

See `docs/policy-baseline.md` for the reviewed official policy sources and remaining publisher requirements.

## Single purpose

Find direct HTTP(S) video files exposed by the current page and send a user-selected file to Chrome's download manager.

## English listing

### Name

Video Downloader

### Short description

Find and download direct video files from the current page.

### Detailed description

Video Downloader scans the current top-level page only when you invoke the extension.

It lists direct MP4, WebM, and similar HTTP(S) video sources and lets you send one to Chrome's download manager.

Signed and Cookie-protected direct URLs may work when Chrome can access them normally.

The extension clearly marks blob, HLS, and DASH streams as unsupported.

It does not merge stream segments, bypass login or paywall restrictions, handle DRM, monitor browsing in the background, or send page data to a server.

Download only videos you own or have permission to save.

### Prominent disclosure

When you invoke the extension, it temporarily reads the current page's title, URL, and video source information to show downloadable candidates.

This information is processed locally and is not stored or transmitted to the developer.

When you select a download, Chrome sends the normal request to that video's source website.

### Permission rationale

- `activeTab` temporarily accesses only the page where the user invoked the extension.
- `scripting` runs the on-demand read-only video collector in that page.
- `downloads` starts the specific download selected by the user.

## 繁體中文商店資訊

### 名稱

影片下載器

### 簡短說明

尋找並下載目前頁面中的直接影片檔案。

### 詳細說明

影片下載器只會在您叫用擴充功能時掃描目前分頁的頂層頁面。

它會列出直接的 MP4、WebM 與類似 HTTP(S) 影片來源，並將您選擇的檔案交給 Chrome 下載管理器。

當 Chrome 能正常存取時，含簽章參數或既有 Cookie 的直接網址可能可以下載。

擴充功能會清楚標示不支援的 blob、HLS 與 DASH 串流。

它不會合併串流分段、繞過登入或付費限制、處理 DRM、在背景監看瀏覽活動，或將頁面資料傳送到伺服器。

請只下載您擁有或獲授權保存的影片。

### 顯著揭露

當您叫用擴充功能時，它會暫時讀取目前頁面的標題、網址與影片來源資訊，以顯示可下載候選項目。

這些資訊只會在本機處理，不會儲存，也不會傳送給開發者。

當您選擇下載時，Chrome 會向該影片的來源網站送出一般下載請求。

### 權限理由

- `activeTab` 只會暫時存取使用者叫用擴充功能的頁面。
- `scripting` 會在該頁面執行按需且唯讀的影片收集器。
- `downloads` 會啟動使用者明確選擇的下載。

## Policy review checklist

- The listing makes one narrow purpose clear.
- The listing never claims support for every site.
- The listing does not mention or target a specific media platform.
- The listing excludes DRM and access-control circumvention.
- The privacy disclosure matches `docs/privacy.md` and the production manifest.
- The final publisher must add support, homepage, and privacy-policy HTTPS URLs.
- Final icons, screenshots, category, and dashboard declarations must match the submitted build.
- The publisher must re-check current Chrome Web Store policies immediately before an authorized submission.
