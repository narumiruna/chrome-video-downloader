# Chrome Video Downloader support matrix

## Scope contract

The product scans only the top-level document of the active tab after a user invokes the extension.

It enables downloads only for validated direct HTTP(S) video candidates.

It does not bypass authentication, anti-hotlinking, paywalls, DRM, or website controls.

The execution request for `docs/plans/archived/2026-08-15_chrome-video-downloader-plan.md` approves this MVP wording and scope.

## Verified environment

| Component | Verified value |
| --- | --- |
| Extension.js | 4.0.32 |
| React | 19.2.8 |
| TypeScript | 7.0.2 |
| Node.js | 26.5.0 |
| npm | 12.0.2 |
| Automated browser | Chrome for Testing 151.0.7922.34 through Playwright Chromium channel |
| Installed system Chrome | 148.0.7778.167 |
| Manifest/API floor | Chrome 96 |

Chrome 96 is the declared API floor because this project uses Promise-returning `chrome.downloads.download()` and Manifest V3 scripting APIs available by that release.

Automated extension loading uses Chrome for Testing because branded Chrome 137 and newer reject the command-line flags used by extension test automation.

A manual load-unpacked pass in branded Chrome remains a release-operator check before an authorized store submission.

## Capability matrix

| Capability | Status | Evidence and behavior |
| --- | --- | --- |
| Direct MP4 | Supported | Playwright downloads `sample.mp4` and verifies SHA-256 `4ea106e27b5ba27763d22eb5322aa519b1c152c38036bca6a4bb277e25455257`. |
| Direct WebM | Supported | Playwright downloads `sample.webm` and verifies SHA-256 `4d5e3e59f9e67f1e5696d3e0883c13b406de707374d6f56df3b80847cd345f13`. |
| Dynamic `currentSrc` with signed query | Supported on controlled fixture | The candidate is downloadable, while `fixture-secret` is absent from rendered UI. |
| Direct URL without file extension | Best effort | The controlled `video/mp4` fixture downloads byte-for-byte, but servers may return a non-video response after scanning. |
| Existing hostname Cookie | Best effort | The controlled Cookie-protected fixture downloads byte-for-byte after `fixture_auth=allowed` is set. |
| Referer, custom header, expiring token, or anti-hotlink requirement | Unverified | Chrome owns the network request, and this extension does not add bypass headers or retry around site controls. |
| Blob/MSE source | Unsupported | The popup explains that page-managed blob videos are unsupported and creates no download. |
| HLS `.m3u8` | Unsupported | The popup identifies HLS and creates no download. |
| MPEG-DASH `.mpd` | Unsupported | The popup identifies DASH and creates no download. |
| Individual `.ts`, `.m4s`, or `.aac` segment | Ignored | Unit and browser fixtures prove segments are not presented as complete videos. |
| Top-level page with no video | Supported empty state | The popup recommends playing the video and scanning again. |
| Cross-origin iframe video | Unsupported | The collector targets only the top frame, and the iframe fixture returns an empty state. |
| `chrome://`, `edge://`, `devtools://`, `view-source:`, `file:` | Restricted | Unit coverage proves these schemes do not reach script injection. |
| Chrome Web Store pages | Restricted | Both current and legacy Web Store URLs are blocked before injection. |
| DRM/EME, paywall, CAPTCHA, or access-control bypass | Prohibited | No implementation, permission, or product claim supports these paths. |

## Fixture ownership and regeneration

All media fixtures use FFmpeg's generated `testsrc2` pattern and contain no third-party media.

Regenerate the fixture set with:

```sh
ffmpeg -y -f lavfi -i 'testsrc2=size=320x180:rate=10' -t 1 -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart e2e/fixtures/media/sample.mp4
ffmpeg -y -f lavfi -i 'testsrc2=size=320x180:rate=10' -t 1 -c:v libvpx-vp9 -b:v 180k e2e/fixtures/media/sample.webm
ffmpeg -y -i e2e/fixtures/media/sample.mp4 -c copy -hls_time 0.5 -hls_playlist_type vod -hls_segment_filename 'e2e/fixtures/manifests/hls/segment-%02d.ts' e2e/fixtures/manifests/hls/sample.m3u8
ffmpeg -y -i e2e/fixtures/media/sample.mp4 -map 0:v -c copy -use_template 1 -use_timeline 1 -f dash e2e/fixtures/manifests/dash/sample.mpd
```

After regeneration, update the expected hashes in `e2e/extension.spec.ts` and rerun `npm run ci`.
