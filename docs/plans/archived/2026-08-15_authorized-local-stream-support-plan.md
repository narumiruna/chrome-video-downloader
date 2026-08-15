# Authorized local adaptive-stream support implementation plan

## Goal

Extend the existing local segment merger so users can remux authorized, finite, unencrypted local adaptive-stream inputs with separate video and audio tracks.

Support bounded local HLS, DASH, and MSE-style fragmented media inputs without discovering, capturing, or downloading website media.

Preserve the browser extension's current permissions, direct-download scope, privacy model, and explicit prohibition on access-control or DRM bypass.

## Context

The current CLI accepts one finite local HLS media playlist or explicitly ordered compatible local segments.

It rejects master playlists and cannot map separate video and audio inputs into one output.

The browser extension intentionally reports Blob/MSE, HLS, and DASH sources as unsupported and ignores individual media segments.

`docs/adr/0001-hls-support.md` keeps adaptive-stream acquisition and assembly out of the extension, but permits a bounded local-only proposal backed by owned fixtures, native FFmpeg evidence, cancellation, cleanup, and policy review.

MSE is a browser playback API rather than a portable manifest format, so this work will accept already-local fragmented MP4 or WebM track files through a versioned local track manifest.

## Architecture

The browser extension will remain unchanged and will not receive host permissions, background execution, request interception, cookie access, or network-fetch capability.

The local CLI will retain the existing `--playlist` and repeated `--segment` modes and add three mutually exclusive input modes:

```sh
npm run merge:segments -- \
  --video-playlist ./video.m3u8 \
  --audio-playlist ./audio.m3u8 \
  --output ./presentation.mp4

npm run merge:segments -- \
  --dash ./presentation.mpd \
  --video-representation video-1080 \
  --audio-representation audio-main \
  --output ./presentation.mkv

npm run merge:segments -- \
  --tracks ./tracks.json \
  --output ./presentation.mkv
```

Separate HLS mode will accept one finite local video media playlist and one finite local audio media playlist rather than discovering variants from a master playlist.

DASH mode will accept a bounded static local profile with one Period, local relative references, and either `SegmentList` or `SegmentTemplate` with `SegmentTimeline`.

A DASH input containing multiple representations for a requested track type will require an explicit representation ID rather than silently choosing quality or language.

The version-one track manifest will contain at most one video track and one audio track, with each track declaring one local initialization file and an ordered non-empty list of local fragments.

```json
{
  "version": 1,
  "video": {
    "init": "video/init.m4s",
    "segments": ["video/part-0001.m4s", "video/part-0002.m4s"]
  },
  "audio": {
    "init": "audio/init.m4s",
    "segments": ["audio/part-0001.m4s", "audio/part-0002.m4s"]
  }
}
```

All manifest references will be resolved under the manifest directory, canonicalized, bounded, checked as regular files, and rejected if they are remote, absolute, encrypted, missing, escaping, or symlinked outside the input root.

Validated HLS inputs will be rewritten into private temporary local-only manifests before FFmpeg receives them.

Validated DASH and MSE-style fragments will be normalized and copied in declared order into private temporary per-track files before FFmpeg receives them.

FFmpeg will receive one explicit input per track, explicit stream mapping, `-c copy`, `-nostdin`, no shell, and a `file`-only protocol whitelist.

FFprobe will verify the required stream types, codecs, finite durations, and usable output before the existing atomic publication step replaces or creates the destination.

Temporary manifests, assembled tracks, partial outputs, and backups will be removed after success, failure, or cancellation.

## Tech Stack

- Keep TypeScript, Node.js, FFmpeg, FFprobe, Vitest, and the existing CLI entry points.
- Use Node streams for bounded-memory sequential assembly of local MSE-style fragments.
- Use a maintained XML parser for DASH only after verifying its entity, DTD, namespace, size-limit, and dependency-audit behavior.
- Continue using repository-owned FFmpeg-generated video and sine-wave audio fixtures for integration evidence.

## Non-Goals

- Do not add YouTube, Vimeo, or any other website-specific extractor.
- Do not inspect network traffic, Media Source buffers, browser caches, service workers, or cross-origin frames.
- Do not accept HTTP(S), Blob, data, file-URL, signed, tokenized, authenticated, or private-player URLs.
- Do not download manifests, segments, keys, subtitles, thumbnails, or metadata.
- Do not support DRM, EME, encryption, live streams, incomplete playlists, low-latency windows, or access-control bypass.
- Do not transcode, repair corrupt fragments, infer missing order, or guarantee every DASH, HLS, codec, and container combination.
- Do not add adaptive-stream download controls to the extension popup.

## Assumptions

- Users obtain every input file through an authorized export or their own media pipeline before invoking this tool.
- Input fragments already contain valid timestamps and codec configuration suitable for stream-copy remuxing.
- FFmpeg and FFprobe remain explicit system prerequisites.
- Matroska is the documented fallback when selected codecs cannot be copied into MP4 or WebM.

## Unknowns

- Resolved: the accepted static DASH profile has one Period and representation-local `SegmentList` or `SegmentTemplate` with a finite `SegmentTimeline`.
- Resolved: sequentially joining the owned fragmented MP4 and WebM initialization and media fragments yields valid per-track FFmpeg inputs.
- Resolved: `fast-xml-parser` 5.10.1 passes entity-disabled parsing, DTD/entity rejection, namespace, malformed, oversized-input, and production dependency-audit checks.
- Resolved: the owned fixtures measure at most 0.007 seconds start skew and 0.027 seconds duration skew, so verification uses a 0.25-second bound.

## Risks

- DASH inheritance and timeline rules are complex, so accepting a broad MPD profile could validate the wrong files or hide remote references.
- Fragment assembly can temporarily require input-sized disk space even when memory use stays bounded.
- Stream-copy output can fail when codecs do not fit the requested container or track timestamps are incompatible.
- Multiple representations can create accidental quality or language choices unless selection is explicit.
- XML, manifest paths, and generated FFmpeg arguments are untrusted local input and require the same path, diagnostic, lifecycle, and output-race hardening as the existing merger.

## Plan

- [x] Create repository-owned two-second video-plus-audio HLS, static DASH, fragmented MP4, and fragmented WebM fixtures under `tests/fixtures/local-streams/`; verify their licenses, generation commands, stream types, codecs, durations, and hashes with FFprobe.
- [x] Run a native FFmpeg feasibility spike against every proposed mode with `-protocol_whitelist file`, `-c copy`, explicit maps, and a bounded-memory fragment assembly prototype; record accepted profiles, rejected profiles, measured duration tolerances, peak disk use, and commands in `docs/adr/0002-authorized-local-adaptive-streams.md`.
- [x] Select and audit the DASH XML parser by testing DTD, entity, namespace, malformed, and oversized inputs; update `package.json`, `package-lock.json`, dependency notices, and the ADR only if the parser passes `npm audit --omit=dev --audit-level=high` and cannot perform external resolution.
- [x] Define the mutually exclusive CLI contract for paired HLS, local DASH, and version-one track-manifest modes in `src/local/merge-cli.ts`; add parser regression tests in `tests/local/merge-cli.test.ts` for required pairs, representation selectors, duplicate flags, conflicting modes, local-path enforcement, help text, and backward compatibility.
- [x] Extract shared canonical local-path validation from `src/local/segment-merger.ts` without weakening existing behavior; add tests proving rejection of absolute manifest references, URI schemes, query strings, control characters, traversal, percent-encoded traversal, missing files, directories, nested manifests, oversized inputs, excessive references, and escaping symlinks before any subprocess starts.
- [x] Add paired finite HLS media-playlist validation and merge orchestration in `src/local/segment-merger.ts`; verify with unit tests that video and audio are mapped explicitly, encrypted/live/master/remote inputs fail closed, and the existing single-playlist mode remains unchanged.
- [x] Add a strict version-one local track-manifest parser and bounded-memory temporary track assembler under `src/local/`; verify ordered fragmented MP4 and WebM assembly, required initialization data, one-video/one-audio limits, exclusive temporary-file creation, cancellation, disk-write failure cleanup, and output preservation with focused tests.
- [x] Add bounded static DASH validation under `src/local/`; support only the ADR-approved one-Period `SegmentList` and `SegmentTemplate` plus `SegmentTimeline` profiles, require explicit representation IDs when ambiguous, and reject `ContentProtection`, dynamic MPDs, external references, XLink, `Location`, `UTCTiming`, byte ranges, unsupported inheritance, unsupported template expansion, and path escape before FFmpeg starts.
- [x] Refactor merge execution to accept one or two validated local track inputs, map exactly the requested first video and audio streams, preserve `-c copy`, retain `file`-only protocols, and verify required stream types, codecs, finite duration, measured synchronization tolerances, and destination-container compatibility before atomic publication.
- [x] Add regression coverage for FFmpeg failure, FFprobe failure, malformed probe output, incompatible containers, missing required streams, duration skew, cancellation during assembly and remuxing, output creation races, overwrite rollback, bounded diagnostics, and cleanup of every temporary artifact.
- [x] Extend `scripts/verify-local-segment-merger.mjs` to exercise existing HLS and ordered-segment modes plus paired HLS, static DASH, fragmented MP4, and fragmented WebM modes against the owned fixtures; require exactly one video stream, exactly one audio stream where requested, expected codecs, measured duration tolerances, and no leftover temporary files.
- [x] Update `README.md`, `docs/local-segment-merger.md`, `docs/support-matrix.md`, `docs/release-audit.md`, CLI help, and `justfile` examples with supported local profiles, representation selection, container compatibility, disk-space behavior, cancellation, recovery, and the unchanged no-network/no-capture/no-DRM boundary.
- [x] Run focused Vitest files, the real FFmpeg/FFprobe integration, `npm run check`, `npm run typecheck`, `npm run audit:dependencies`, `npm run build:chrome`, `npm run test:e2e:built`, `npm run audit:artifact`, and `npm run ci`; leave any unavailable or failing check open with its exact evidence.
- [x] Review the complete diff for parser safety, path containment, subprocess arguments, protocol isolation, temporary-file permissions, cancellation, output races, privacy, extension-bundle separation, compatibility, and same-pattern regressions; add regression tests for every valid finding and rerun affected checks.
- [x] Confirm the production manifest still has only `activeTab`, `scripting`, and `downloads`, the extension artifact contains no XML parser or local merger runtime, and no extension behavior claims adaptive-stream downloading.
- [x] Audit every completion criterion against code, fixtures, command output, documentation, and artifact contents; then archive this plan under `docs/plans/archived/`, create focused signed Conventional Commits, push the implementation branch, and open a pull request linking the archived plan and verification evidence.

## Execution Evidence

- `npm ci` installed the locked dependency graph successfully, and `npm audit --omit=dev --audit-level=high` reported zero production vulnerabilities.
- TDD began with eight failing CLI tests and four failing merger-orchestration tests before the corresponding behavior was implemented.
- `npm test` passed 141 tests across ten files, including XML, path, encryption, ambiguity, output verification, cancellation, disk-write, race, and cleanup regressions.
- `npm run test:merge:integration` verified legacy HLS/segments, paired HLS, static DASH, fragmented MP4, fragmented WebM, fixture hashes, incompatible-container rejection, and temporary-file cleanup with native FFmpeg and FFprobe.
- `npm run ci` passed Biome, Vitest, TypeScript, native merger integration, the production dependency audit, the Extension.js build, nine Playwright tests, and the artifact audit.
- The artifact audit found 13 files, exactly three permissions, one valid zip, no host permissions, and no local adaptive-stream runtime in the extension bundle.
- Hardening found and covered duplicate HLS encryption methods, null declared tracks, unsupported Period inheritance, encryption-marked initialization files, partial track-write cleanup, and deterministic WebM fixture generation.
- The final security and lifecycle review found no remaining actionable correctness, path-containment, subprocess, protocol, cleanup, permission, privacy, or extension-separation issue.
- Signed implementation commit `bb922bd` was pushed, and pull request #3 was opened with verification evidence, limits, and a link to this archived plan.

## Completion Checklist

- [x] Existing `--playlist` and repeated `--segment` commands remain backward compatible and pass their current unit and integration tests.
- [x] Paired local HLS media playlists produce one verified output containing the expected video and audio streams from repository-owned fixtures.
- [x] An approved static local DASH profile produces one verified output containing the explicitly selected video and audio representations from repository-owned fixtures.
- [x] Version-one local track manifests produce verified outputs from repository-owned fragmented MP4 and fragmented WebM video/audio tracks without loading all fragments into memory.
- [x] Remote, signed, authenticated, encrypted, DRM-protected, live, malformed, ambiguous, unsupported, escaping, missing, oversized, and excessive-reference inputs fail before FFmpeg starts.
- [x] FFmpeg and FFprobe run without a shell and can access only local `file` inputs created or validated by the tool.
- [x] Outputs with missing streams, invalid duration, unacceptable synchronization skew, or incompatible containers are rejected before publication.
- [x] Existing outputs are preserved unless `--overwrite` is explicit, and failure or cancellation leaves no partial output, backup, assembled track, or temporary manifest.
- [x] Documentation states that MSE input means already-local authorized fragments and does not imply browser capture or website support.
- [x] The browser extension retains its current permission set, unsupported adaptive-stream UI, network behavior, privacy model, and production artifact composition.
- [x] Focused tests, real native integration checks, dependency audit, full repository CI, artifact audit, and final security and lifecycle review pass with recorded evidence.
