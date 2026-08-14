# Chrome Video Downloader

Chrome Video Downloader finds direct HTTP(S) video files on the current page and sends selected files to Chrome's download manager.

It does not merge HLS or DASH streams, inspect cross-origin frames, bypass access controls, or handle DRM-protected media.

Use it only for videos you own or have permission to save.

## Requirements

- Node.js 22 or newer.
- npm 12 or a compatible npm release.
- Chrome 96 or newer for the required extension APIs.
- A current Chromium browser for automated E2E tests.

## Install

```sh
npm ci
```

## Develop

```sh
npm run dev
```

Extension.js opens a fresh Chrome profile with the unpacked extension installed.

Open a page containing a direct video and click the extension action, or press `Alt+Shift+V`.

## Test

```sh
npm test
npm run typecheck
npm run check
npm run test:e2e
```

Run the complete repository gate with:

```sh
npm run ci
```

The E2E suite uses only locally generated media under `e2e/fixtures/`.

It adds a localhost host permission to a temporary copy of the production artifact because headless Chromium cannot invoke the browser toolbar.

The production manifest is audited separately and never contains that test permission.

## Build and load unpacked

```sh
npm run build:chrome
```

The unpacked artifact is written to `dist/chrome`.

The store-ready archive is written inside that directory as `video-downloader-0.1.0.zip`.

To inspect the production build manually:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Select **Load unpacked**.
4. Choose the absolute `dist/chrome` directory.
5. Open a controlled page containing a direct MP4 or WebM file.
6. Click the extension action and verify scanning and download behavior.

## Architecture

- `src/content/` contains the on-demand, read-only page collector.
- `src/core/` validates, classifies, redacts, deduplicates, and sorts untrusted page data.
- `src/platform/` contains the minimal Chrome API adapters.
- `src/popup/` contains the React and Radix UI popup.
- `tests/` contains deterministic unit and component tests.
- `e2e/` contains controlled browser fixtures and Playwright tests.

The production extension has no background worker, persistent content script, host permission, remote server, analytics, or storage.

## Product and release documents

- [Support matrix](docs/support-matrix.md)
- [Privacy policy](docs/privacy.md)
- [Chrome Web Store policy baseline](docs/policy-baseline.md)
- [Store listing draft](docs/store-listing.md)
- [Release audit](docs/release-audit.md)
- [HLS decision](docs/adr/0001-hls-support.md)
