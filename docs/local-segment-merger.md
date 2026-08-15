# Local segment merger

The local segment merger remuxes media files that are already on your computer into one playable file.

It never discovers or downloads media, sends network requests, decrypts content, or bypasses website controls.

Use it only with media you own or are authorized to process.

## Prerequisites

- Node.js 22 or newer.
- Project dependencies installed with `npm ci`.
- `ffmpeg` and `ffprobe` available on `PATH`.

Check the native tools before starting:

```sh
ffmpeg -version
ffprobe -version
```

## Merge a local HLS media playlist

```sh
npm run merge:segments -- \
  --playlist ./recording/index.m3u8 \
  --output ./recording.mp4
```

The playlist must be a finite, unencrypted media playlist ending in `#EXT-X-ENDLIST`.

Every segment and `EXT-X-MAP` initialization file must exist beneath the playlist directory.

Remote URLs, URI schemes, query strings, path traversal, escaping symlinks, encryption, live playlists, and master playlists are rejected before FFmpeg starts.

For fragmented MP4 input, prefer a local media playlist containing its `EXT-X-MAP` initialization file.

## Merge explicitly ordered segments

Repeat `--segment` in playback order:

```sh
npm run merge:segments -- \
  --segment ./parts/part-000.ts \
  --segment ./parts/part-001.ts \
  --segment ./parts/part-002.ts \
  --output ./recording.mp4
```

Explicit segments must have compatible codecs, stream layouts, and timestamps that FFmpeg's concat demuxer can remux without transcoding.

This mode works well for compatible MPEG-TS segments.

It does not infer order from filenames.

## Replace an existing output

The tool preserves an existing output by default.

Pass `--overwrite` to replace it only after a new output passes FFprobe verification:

```sh
npm run merge:segments -- \
  --playlist ./recording/index.m3u8 \
  --output ./recording.mp4 \
  --overwrite
```

Supported single-file output extensions are `.mp4`, `.m4v`, `.mov`, `.mkv`, `.webm`, and `.ts`.

The tool copies existing streams with `-c copy`; it does not transcode incompatible codecs for a selected container.

## Just recipe

Arguments can also be passed through Just:

```sh
just merge --playlist ./recording/index.m3u8 --output ./recording.mp4
```

## Help and exit status

```sh
npm run merge:segments -- --help
```

- Exit `0` means the output was merged and verified.
- Exit `1` means validation, FFmpeg, or FFprobe failed.
- Exit `2` means the command arguments were invalid.

Press `Ctrl+C` to cancel a running merge.

Temporary concat manifests and partial outputs are removed after success, failure, or cancellation.

## Safety boundary

Do not pass browser URLs, private player manifests, encrypted playlists, access tokens, or website cache files to this tool.

Use the content provider's official download or export function to obtain authorized local inputs first.
