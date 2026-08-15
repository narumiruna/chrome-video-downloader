# Authorized local adaptive-stream fixtures

These two-second fixtures are generated entirely from FFmpeg's `testsrc2` video source and `sine` audio source.

They contain no third-party media and are committed only for deterministic local integration tests.

Run `./generate.sh` from any working directory to regenerate finite separate-track HLS, static DASH fMP4, and static DASH WebM inputs.

`tracks-fmp4.json` and `tracks-webm.json` describe the generated fragments in playback order for local track-manifest tests.

After regeneration, run the integration verifier and update `SHA256SUMS` plus the manifest hashes recorded in `docs/adr/0002-authorized-local-adaptive-streams.md` if the installed FFmpeg produces different bytes.
