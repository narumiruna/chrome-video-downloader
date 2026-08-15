# ADR 0003: Remux captured fragmented MP4 in the browser

- Status: Accepted.
- Date: August 15, 2026.
- Supersedes: The extension-specific no-capture boundary in ADR 0001 and ADR 0002 for this narrow profile only.

## Context

Some authorized embedded players expose no complete file and instead request separate unencrypted fragmented MP4 video and audio tracks.

Presenting every `video/mp4` or `audio/mp4` response as a separate download produces incomplete and misleading files.

The extension must not parse arbitrary adaptive manifests, decrypt media, inspect MSE buffers, or rely on a native FFmpeg installation.

## Evidence

The repository-owned fixture contains separate H.264 video and AAC audio initialization segments plus shuffled fMP4 media fragments.

The browser implementation identifies initialization data by `ftyp` and `moov`, orders media fragments by `tfdt`, and remuxes the tracks with the locally bundled Mediabunny library.

Unit evidence verifies one output containing both tracks with a duration above two seconds.

A controlled unpacked-extension run produced a 62,654-byte MP4 containing video and audio with a 2.021-second duration.

## Decision

Use `webRequest` and host access to retain media request URLs, MIME types, timestamps, and HTTP byte ranges by tab in memory.

Cap captures at 1,000 unique URL-and-range records per tab in `storage.session` and remove stale records after five minutes.

Never present individual captured fragments as complete video downloads.

When the user chooses **Assemble MP4**, refetch only captured `video/mp4` and `audio/mp4` responses from their original hosts.

Require an MP4 initialization segment for every included track.

Sort fragmented media by `tfdt`, reject empty or oversized parts, cap total in-memory input at 512 MiB, and deduplicate repeated decode times.

Use Mediabunny composable conversions to copy encoded video and audio packets into one MP4 without transcoding.

Publish the result through Chrome's download manager only after successful finalization.

## Boundaries

General HLS and DASH manifest parsing remains unsupported.

Encrypted media, DRM, missing initialization data, expired URLs, mixed incompatible representations, live capture, non-MP4 fragments, repair, and access-control bypass remain unsupported.

Assembly runs in the popup and stops if the popup closes.

The implementation is best effort because source URLs may expire or require request context that an extension fetch cannot reproduce.

## Consequences

The extension requires a background service worker, `webRequest`, `storage`, `alarms`, `downloads`, and host access.

Media request metadata is processed locally and retained only in non-persistent session memory.

The extension bundle grows because it includes a local MP4 demuxer and muxer.

Chrome Web Store disclosures, permission rationale, privacy documentation, and artifact auditing must reflect the broader runtime behavior.
