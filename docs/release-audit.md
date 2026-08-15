# Release audit

Audit date: August 15, 2026.

## Automated evidence

- `npm run check` passes Biome across source, tests, fixtures, scripts, and documentation-supported formats.
- `npm test` passes 149 unit and component tests, including browser-side fragmented MP4 video/audio remuxing with embedded initialization metadata, adaptive-manifest validation, injected-boundary limits, and local segment merger lifecycle coverage.
- `npm run typecheck` passes TypeScript strict checking.
- `npm run test:merge:integration` passes real FFmpeg/FFprobe checks for legacy HLS and ordered MPEG-TS plus separate-track HLS, static DASH, fragmented MP4, and fragmented WebM inputs.
- `npm run build:chrome` produces `dist/chrome` and `video-downloader-0.1.0.zip` with Extension.js 4.0.32.
- `npm run test:e2e:built` passes ten Chromium extension tests against locally generated fixtures, including browser-side fMP4 assembly.
- Direct MP4, WebM, dynamic, extensionless, and authenticated fixture downloads match expected SHA-256 hashes.
- Individual captured URLs are not presented as complete downloads, and compatible MP4 video/audio fragments plus bounded initialization metadata are grouped behind one assembly action.
- A controlled unpacked-extension check assembled shuffled H.264 and AAC fMP4 fragments into a 62,654-byte MP4 with both tracks and a 2.021-second duration.
- Axe reports no accessibility violations in the populated popup fixture.
- Keyboard focus order, reduced motion, stable popup proportions, and 200% text scaling pass automated checks.
- The real Chrome action popup and empty fixture render at 400×320 CSS pixels, while the two-candidate fixture renders at 400×490 CSS pixels without unused live-status space.
- The [200% text-scaling screenshot](assets/popup-200-percent.png) keeps the primary action, candidate details, privacy notice, and rights notice visible without horizontal clipping.
- `npm run audit:artifact` confirms the six reviewed permissions, required host access, expected background worker, one valid zip, packaged notices, no source maps, no development URL, no remote script/CSS, no `eval`, and no fixture token.
- `npm audit --omit=dev --audit-level=high` reports zero production dependency vulnerabilities.

## Manifest review

The production manifest contains `activeTab`, `scripting`, `downloads`, `webRequest`, `alarms`, and `storage` permissions plus `<all_urls>` host access.

The host access and background worker are required to observe cross-origin media responses and fetch the exact fragments chosen for local assembly.

It contains no optional permissions, static content script, `debugger`, `offscreen`, or persistent storage.

The `Alt+Shift+V` command is an alternate user gesture for opening the action popup and adds no permission.

## Trust-boundary review

Collector output is treated as untrusted even though Chrome structured-clones it.

The validator bounds strings, numbers, URLs, and candidate count before data reaches React or Chrome downloads.

Only credential-free HTTP(S) direct candidates pass the direct-download adapter's second runtime check.

Captured HTTP(S) fragment URLs, supported playlist-metadata URLs, and byte ranges remain in memory, are bounded per tab, and are never rendered or persisted.

Signed query strings remain in actual requests but never appear in display names, user-facing errors, diagnostics, or storage.

The local merger rejects network URLs, DTDs, XML entities, external DASH references, escaping paths, encryption, live input, and unsupported ambiguity before FFmpeg starts.

FFmpeg and FFprobe run without a shell with `file` as the only permitted protocol, and separate-track outputs are verified before atomic publication.

Mediabunny is bundled locally and remuxes encoded packets without a server or remote executable code.

The extension has no analytics, persistent storage, remote assets, or developer-controlled processing service.

## Lifecycle review

The popup uses scan generations to ignore stale out-of-order scan completions.

It ignores asynchronous results after unmount and clears pending in-memory guards during cleanup.

A per-candidate synchronous guard blocks double submissions while leaving other candidates available.

Chrome owns download continuation after the popup submits the assembled Blob.

Closing the popup stops in-progress assembly.

The background worker keeps at most 1,000 unique URL-and-range records per tab in `storage.session` and removes stale tab records after five minutes.

## Dependency review

The shipped dependency graph includes `fast-xml-parser` for the local DASH CLI and Mediabunny for extension-side MP4 remuxing.

`npm audit --omit=dev` remains a required release gate.

The full development graph reports six high-severity advisories under Extension.js tooling, including archive extraction and image parsing paths.

Extension.js 4.0.32 is the current selected framework version, and npm offers only a downgrade to 3.5.1 as an automatic audit fix.

This project does not use Extension.js's remote store archive extraction path and feeds only repository-owned images to the build.

The residual tooling risk is accepted for this implementation but must be rechecked when Extension.js publishes patched transitive dependencies.

## Manual and external checks

Chrome for Testing 151 successfully loads and exercises the production artifact.

A clean temporary Chrome for Testing profile also loads the unpacked contents of the generated release zip and reaches the restricted-page recovery state.

Branded system Chrome 148 rejects automated `--load-extension` flags, which is expected for Chrome 137 and newer.

A human must perform the README load-unpacked smoke test in the final target Chrome Stable profile before an authorized store submission.

Chrome Web Store review, public privacy-policy hosting, final screenshots, and external submission were not performed because this task does not authorize store publication.
