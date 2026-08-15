# Release audit

Audit date: August 15, 2026.

## Automated evidence

- `npm run check` passes Biome across source, tests, fixtures, scripts, and documentation-supported formats.
- `npm test` passes 89 unit and component tests, including injected-boundary limits and local segment merger lifecycle coverage.
- `npm run typecheck` passes TypeScript strict checking.
- `npm run test:merge:integration` passes real FFmpeg/FFprobe checks for a one-second local HLS fixture and two seconds of explicitly ordered local MPEG-TS input.
- `npm run build:chrome` produces `dist/chrome` and `video-downloader-0.1.0.zip` with Extension.js 4.0.32.
- `npm run test:e2e:built` passes eight Chromium extension tests against locally generated fixtures.
- Direct MP4, WebM, dynamic, extensionless, and authenticated fixture downloads match expected SHA-256 hashes.
- Blob, HLS, DASH, segment-heavy, and cross-origin iframe fixtures create no misleading download action.
- Axe reports no accessibility violations in the populated popup fixture.
- Keyboard focus order, reduced motion, stable popup proportions, and 200% text scaling pass automated checks.
- The empty fixture renders at 400×320 CSS pixels, while the two-candidate fixture renders at 400×490 CSS pixels without unused live-status space.
- The [200% text-scaling screenshot](assets/popup-200-percent.png) keeps the primary action, candidate details, privacy notice, and rights notice visible without horizontal clipping.
- `npm run audit:artifact` confirms exactly three permissions, one valid zip, packaged project and third-party notices, no host permissions, no background worker, no source maps, no development URL, no remote script/CSS, no `eval`, and no fixture token.
- `npm audit --omit=dev --audit-level=high` reports zero production dependency vulnerabilities.

## Manifest review

The production manifest contains only `activeTab`, `scripting`, and `downloads` permissions.

It contains no `host_permissions`, optional permissions, background worker, static content script, `webRequest`, `debugger`, `offscreen`, or storage permission.

The `Alt+Shift+V` command is an alternate user gesture for opening the action popup and adds no permission.

## Trust-boundary review

Collector output is treated as untrusted even though Chrome structured-clones it.

The validator bounds strings, numbers, URLs, and candidate count before data reaches React or Chrome downloads.

Only credential-free HTTP(S) direct candidates pass the download adapter's second runtime check.

Signed query strings remain in the actual URL but never appear in display names, user-facing errors, diagnostics, or storage.

The extension has no analytics, server, persistent state, logs, remote assets, or remote executable code.

## Lifecycle review

The popup uses scan generations to ignore stale out-of-order scan completions.

It ignores asynchronous results after unmount and clears pending in-memory guards during cleanup.

A per-candidate synchronous guard blocks double submissions while leaving other candidates available.

Chrome owns download continuation after the popup closes.

No page observer, injected DOM, event listener, content script registration, background worker, timer, or retained browser state survives a scan.

## Dependency review

The shipped dependency graph reports no known vulnerability through `npm audit --omit=dev`.

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
