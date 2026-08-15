# ADR 0001: Do not add HLS assembly to the MVP

- Status: Declined for general HLS; superseded in part by ADR 0003 for captured fragmented MP4 only.
- Date: August 15, 2026.

## Context

The direct-video MVP can identify an HLS manifest but cannot turn every HLS presentation into one correct downloadable file.

The controlled VOD fixture contains a 145-byte playlist, one 20,304-byte MPEG-TS segment, one H.264 video stream, and a one-second duration.

FFprobe can read this simple fixture as HLS, but it represents only the easiest muxed, unencrypted, finite case.

A native FFmpeg remux produced a playable one-second MP4 with SHA-256 `b8be6ca90a04c0a3b253f38636ad6774a31550c8ed661248cb809bdf876b20d1` in 0.05 seconds with 55,972 KB maximum resident memory.

A missing-segment variant failed with status 183 after 0.03 seconds and produced no output file.

These native command-line numbers do not predict browser or ffmpeg.wasm memory and CPU costs.

The fixture has video only, so it does not prove separate-audio synchronization, variant choice, cancellation, or retry behavior.

Real HLS presentations may contain master and variant playlists, separate audio, initialization sections, discontinuities, byte ranges, expiring URLs, encryption, live windows, and multiple origins.

## Options considered

| Option | Permissions and runtime | Main costs and risks |
| --- | --- | --- |
| Keep HLS unsupported | No additional permission or runtime | Lower detection coverage, but behavior remains honest and bounded. |
| Fetch and concatenate segments | Optional host permissions and long-running work | Concatenation is not valid for every segment/container arrangement and does not solve separate audio. |
| Use an offscreen document and workers | Adds `offscreen` plus host permissions | Introduces lifecycle, cancellation, memory, cleanup, and review complexity. |
| Bundle ffmpeg.wasm | Adds a large local runtime and WASM CSP needs | High bundle size, CPU, memory, startup, cancellation, and device-compatibility costs. |
| Send media to a backend | Adds network transfer and server processing | Conflicts with the local-only privacy model and adds cost, retention, copyright, and security risk. |

Encrypted HLS, DRM, live streams, DASH, and website restriction bypass remain prohibited regardless of the chosen architecture.

## Decision

Keep HLS identification as an unsupported explanatory state.

Do not add host permissions, offscreen documents, workers, ffmpeg.wasm, remote processing, segment downloading, or muxing.

No separate browser-extension HLS implementation plan is required because the decision is no-go.

The repository's optional local segment merger processes only user-provided, finite, unencrypted files already on disk and does not change this browser-extension decision or its permissions.

Cancellation, retry, browser-memory, and separate-audio gates therefore remain intentionally unmet rather than being hidden behind an incomplete browser implementation.

## Consequences

The production permission set remains `activeTab`, `scripting`, and `downloads`.

Users receive a truthful HLS explanation instead of a playlist or partial-segment download.

ADR 0003 reopens only a narrow unencrypted fragmented MP4 profile with separate-audio fixtures, bounded memory, local remuxing, cleanup, and explicit product approval.

General HLS parsing and assembly remain declined.
