# ADR 0002: Support bounded authorized local adaptive streams

- Status: Accepted.
- Date: August 15, 2026.

## Context

The local segment merger supports one finite HLS media playlist or explicitly ordered compatible segments, but it cannot combine separate video and audio tracks.

MSE is a browser API rather than a file format, and complete DASH and HLS specifications include network, live, encrypted, inherited, and ambiguous forms that exceed the local tool's safety boundary.

The browser extension must retain its direct-file scope and must not acquire adaptive streams from websites.

## Feasibility evidence

Repository-owned two-second fixtures use FFmpeg `testsrc2` video and `sine` audio without third-party media.

Native FFmpeg 6.1.1 remuxed separate finite fMP4 HLS video and AAC audio playlists into a 2.027-second MP4 containing H.264 video and AAC audio.

Sequentially assembling DASH initialization and media fragments produced a 37,705-byte H.264 track and a 26,177-byte AAC track, which FFmpeg remuxed into a 2.005-second MP4.

Sequentially assembling WebM initialization and media fragments produced a 33,876-byte VP9 track and a 23,860-byte Opus track, which FFmpeg remuxed into a 2.008-second WebM.

Each native remux completed in 0.03 seconds with at most 56,876 KB maximum resident memory, and shell-based sequential fragment assembly used 1,864 KB maximum resident memory for the controlled fixture.

The measured video/audio start-time skew was at most 0.007 seconds, and the measurable stream-duration skew was at most 0.027 seconds.

`tests/fixtures/local-streams/SHA256SUMS` records and the native integration verifier checks all 27 generated manifests, initialization files, fragments, and track manifests.

The committed HLS video playlist, HLS audio playlist, DASH MPD, fMP4 track manifest, and WebM track manifest have SHA-256 values `a514051104c24775176f6523bb2bea39a755c172f9533854857aa213fae7b04e`, `a65ed3bcee4bfce6346dc9f7395a443b84dd2f3e30588cbee6a62eb4038e9668`, `6bb279f316c5ed44d96056c2127846a489bf62184e646f9c8e6ef810eb9ccfcf`, `f28d6ad51cbf498e8cdc7170f416f199695a50b21b8405f0cf634dcbac3ead1d`, and `8465a62cdb470da324b7e59709abdc7ef363225767c0c3169ad332bcab9fc718` respectively.

## Decision

Extend only the local CLI with mutually exclusive paired-HLS, static-DASH, and version-one local track-manifest input modes.

Keep existing single-playlist and ordered-segment behavior backward compatible.

Accept paired HLS only as two explicit finite unencrypted media playlists.

Accept DASH only when it is static, has one Period, has no `ContentProtection`, and uses representation-local `SegmentList` or `SegmentTemplate` with a finite `SegmentTimeline`.

Require an explicit representation ID when a requested video or audio track has multiple representations.

Accept a version-one JSON track manifest containing at most one video and one audio track, where each track has one initialization file and an ordered non-empty fragment list.

Resolve every media reference beneath the local manifest directory and reject remote, absolute, query-bearing, malformed, missing, excessive, escaping, or encryption-marked references before FFmpeg starts.

Parse DASH with `fast-xml-parser` 5.x using entity processing disabled after rejecting DTD and entity declarations before parsing.

Ignore and never resolve XML namespace and schema-location metadata, while rejecting media-bearing external-reference elements and attributes.

Normalize DASH and track-manifest inputs into private assembled per-track files, and normalize HLS inputs into private sanitized local playlists.

Invoke FFmpeg and FFprobe without a shell and with a `file`-only protocol whitelist.

Use stream copy only, require finite positive output duration, require expected stream types, and reject video/audio start or measurable duration skew above 0.25 seconds.

Verify output before atomic publication and remove all temporary artifacts after success, failure, or cancellation.

## Rejected profiles

Dynamic MPDs, multiple Periods, negative timeline repeats, timeline-free templates, `SegmentBase`, byte ranges, XLink, `Location`, `UTCTiming`, remote references, master HLS playlists, encrypted media, live media, and incomplete media are rejected.

Unsupported template tokens and ambiguous representations are rejected rather than guessed.

Website extraction, browser request interception, cache inspection, media-buffer capture, decryption, and access-control bypass remain prohibited.

## Consequences

The local tool temporarily requires approximately the combined input-track size in the output filesystem while assembling fragmented inputs.

Stream-copy compatibility still depends on the selected codecs and destination container, with Matroska as the documented fallback.

The browser extension remains unchanged with only `activeTab`, `scripting`, and `downloads`, and its Blob/MSE, HLS, and DASH UI remains unsupported.

The XML parser is a production dependency for the local CLI but must remain absent from the extension bundle and pass the production dependency audit.
