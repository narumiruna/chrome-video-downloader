# Chrome Video Downloader support matrix

## Scope contract

The product scans the active top-level page and transiently captures media requests associated with each tab.

It downloads validated direct HTTP(S) videos and can remux captured compatible unencrypted fragmented MP4 video and audio into one MP4.

It does not bypass authentication, anti-hotlinking, paywalls, DRM, encryption, or website controls.

The separate local CLI continues to support bounded authorized adaptive-stream files already on disk.

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
| Manifest/API floor | Chrome 102 |

Chrome 102 is the declared API floor because captured request metadata uses `chrome.storage.session` to survive Manifest V3 service-worker suspension without persistent disk storage.

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
| HLS `.m3u8` | Unsupported | The popup identifies HLS manifests but does not parse or assemble them. |
| MPEG-DASH `.mpd` | Unsupported as a manifest | The popup does not parse MPDs or select DASH representations. |
| Captured fragmented MP4 video plus audio | Best effort | The browser uses captured initialization responses or bounded embedded initialization metadata matched to exact captured segment URLs, orders media by `tfdt`, and remuxes compatible tracks locally with Mediabunny. |
| Missing, expired, encrypted, mixed-representation, or non-MP4 fragment set | Unsupported | Assembly fails without publishing a partial output and asks the user to replay from the beginning. |
| Individual `.ts`, `.m4s`, or `.aac` segment | Never presented as a complete video | Captured MP4 parts are grouped behind one assembly action, while TS and AAC parts remain unsupported. |
| Top-level page with no video | Supported empty state | The popup recommends playing the video and scanning again. |
| Cross-origin iframe fragmented MP4 | Best effort | The background worker can observe authorized media requests when host access applies, without reading the iframe DOM. |
| `chrome://`, `edge://`, `devtools://`, `view-source:`, `file:` | Restricted | Unit coverage proves these schemes do not reach script injection. |
| Chrome Web Store pages | Restricted | Both current and legacy Web Store URLs are blocked before injection. |
| DRM/EME, paywall, CAPTCHA, or access-control bypass | Prohibited | No implementation, permission, or product claim supports these paths. |
| Paired finite local HLS media playlists | Supported by local CLI only | Native integration verifies H.264 video plus AAC audio in a 2.027-second MP4. |
| Bounded static local DASH | Supported by local CLI only | Native integration verifies one selected H.264 representation plus one AAC representation in a 2.005-second MP4. |
| Authorized local fragmented MP4 track manifest | Supported by local CLI only | Native integration assembles ordered init/media fragments and verifies H.264 plus AAC in a 2.005-second MP4. |
| Authorized local fragmented WebM track manifest | Supported by local CLI only | Native integration assembles ordered init/media fragments and verifies VP9 plus Opus in a 2.008-second WebM. |
| General adaptive-stream acquisition or browser MSE buffer capture | Unsupported | The extension only remuxes observed unencrypted MP4 HTTP responses and does not inspect MSE buffers, parse general manifests, decrypt, or repair streams. |

## Fixture ownership and regeneration

All media fixtures use FFmpeg's generated `testsrc2` pattern and contain no third-party media.

Regenerate the fixture set with:

```sh
ffmpeg -y -f lavfi -i 'testsrc2=size=320x180:rate=10' -t 1 -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart e2e/fixtures/media/sample.mp4
ffmpeg -y -f lavfi -i 'testsrc2=size=320x180:rate=10' -t 1 -c:v libvpx-vp9 -b:v 180k e2e/fixtures/media/sample.webm
ffmpeg -y -i e2e/fixtures/media/sample.mp4 -c copy -hls_time 0.5 -hls_playlist_type vod -hls_segment_filename 'e2e/fixtures/manifests/hls/segment-%02d.ts' e2e/fixtures/manifests/hls/sample.m3u8
ffmpeg -y -i e2e/fixtures/media/sample.mp4 -map 0:v -c copy -use_template 1 -use_timeline 1 -f dash e2e/fixtures/manifests/dash/sample.mpd
```

After regenerating the browser fixtures, update the expected hashes in `e2e/extension.spec.ts`.

Regenerate the separate-track local adaptive fixtures with:

```sh
tests/fixtures/local-streams/generate.sh
```

After regenerating the adaptive fixtures, update `tests/fixtures/local-streams/SHA256SUMS` and the representative hashes in `docs/adr/0002-authorized-local-adaptive-streams.md`.

Rerun `npm run ci` after changing either fixture set.
