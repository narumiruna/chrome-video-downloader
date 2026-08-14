# Local segment merger implementation plan

## Goal

Add a general-purpose command-line tool that remuxes user-provided local, unencrypted HLS playlists or explicitly ordered local media segments into one playable local output without network access.

The tool must not discover, download, decrypt, or bypass controls on websites or private media.

## Plan

- [x] Define and test CLI argument parsing for a local HLS input or repeated ordered segment inputs, one output, overwrite behavior, and actionable usage errors.
- [x] Define and test local HLS validation that rejects remote URLs, URI schemes, encryption, live playlists, master playlists, path traversal, missing files, and symlink escape.
- [x] Define and test safe FFmpeg execution, atomic output replacement, bounded diagnostics, failure cleanup, and output stream verification.
- [x] Implement the TypeScript merger and CLI with FFmpeg/FFprobe as explicit local prerequisites and no network capability.
- [x] Add `npm run merge:segments` and `just merge` entry points.
- [x] Verify real remuxing against the repository-owned HLS and MPEG-TS fixtures and compare duration and stream metadata with FFprobe.
- [x] Document supported inputs, examples, safety boundaries, failure recovery, and limitations.
- [x] Run focused tests, `npm run ci`, diff review, and security/path handling review.
- [ ] Commit signed changes, push the existing feature branch, and update pull request #1.

## Execution Evidence

- TDD began with six failing CLI parser tests and eight failing playlist-validation tests before implementation.
- Hardening regressions cover percent-encoded remote URIs, variable substitution, nested manifests, concat directive injection, symlink escape, output races, non-file targets, and cancellation before publication.
- `npm ci` installed the lockfile successfully.
- `npm run test:merge:integration` remuxed the owned local HLS fixture to a one-second H.264 MP4 and two explicitly ordered MPEG-TS inputs to a two-second H.264 MP4.
- The integration verifier uses FFprobe to require a video stream and durations within 0.05 seconds of the fixture expectations.
- `npm run ci` passed Biome, 88 Vitest tests, TypeScript, the real FFmpeg/FFprobe integration, the production dependency audit, Extension.js build, seven Playwright tests, and the artifact audit.
- The production extension artifact remains unchanged in capability and still has exactly three permissions with no host permission or local merger code bundled into it.
- The merger invokes FFmpeg and FFprobe without a shell and restricts protocols to `file`.
- The merger accepts only local regular files, creates sanitized temporary manifests with mode `0600`, verifies output before publication, prevents no-overwrite races with an atomic hard link, and cleans temporary files in `finally`.

## Completion Checklist

- [x] A local VOD HLS playlist can be remuxed into a playable output.
- [x] Ordered compatible local MPEG-TS segments can be remuxed into a playable output.
- [x] Remote, encrypted, live, escaping, malformed, and missing inputs fail before FFmpeg starts.
- [x] Existing output is preserved unless `--overwrite` is explicitly supplied.
- [x] Failed and cancelled merges leave no partial output or temporary files.
- [x] Help and errors do not imply support for downloading or bypassing restricted media.
- [x] Focused tests and the repository CI pass.
