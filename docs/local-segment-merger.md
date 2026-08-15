# Local segment merger

The local segment merger remuxes media files that are already on your computer into one playable file.

It never discovers, captures, or downloads media, sends network requests, decrypts content, or bypasses website controls.

Use it only with media you own or are authorized to process.

The XML parser and its local CLI dependencies are listed in [local third-party notices](local-third-party-notices.md).

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

## Merge separate local HLS video and audio

Provide exactly one finite unencrypted video media playlist and one finite unencrypted audio media playlist:

```sh
npm run merge:segments -- \
  --video-playlist ./recording/video.m3u8 \
  --audio-playlist ./recording/audio.m3u8 \
  --output ./recording.mp4
```

Both playlists pass the same local-path, encryption, live, master-playlist, reference-count, and symlink-containment validation as single-playlist mode.

The tool maps the first video stream from the video playlist and the first audio stream from the audio playlist.

It does not discover variants from an HLS master playlist.

## Merge a bounded static local DASH presentation

```sh
npm run merge:segments -- \
  --dash ./recording/presentation.mpd \
  --output ./recording.mkv
```

DASH support is intentionally limited to one static Period and representation-local `SegmentList` or `SegmentTemplate` with a finite `SegmentTimeline`.

Every initialization and media reference must resolve to a local fragmented MP4 or WebM file beneath the MPD directory.

If a video or audio track has multiple representations, select each representation explicitly:

```sh
npm run merge:segments -- \
  --dash ./recording/presentation.mpd \
  --video-representation video-1080 \
  --audio-representation audio-main \
  --output ./recording.mkv
```

Dynamic MPDs, multiple Periods, `ContentProtection`, `BaseURL`, `SegmentBase`, byte ranges, XLink, `Location`, `UTCTiming`, negative repeats, timeline-free templates, unsupported template tokens, and ambiguous representations are rejected.

XML DTD and entity declarations are rejected before parsing, and schema-location metadata is never resolved.

## Merge authorized local MSE-style fragments

MSE is a browser API rather than a manifest format.

This mode accepts only fragments already exported to local storage through an authorized workflow.

Create a version-one local track manifest containing at most one video track and one audio track:

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

Run the merger with the local JSON path:

```sh
npm run merge:segments -- \
  --tracks ./recording/tracks.json \
  --output ./recording.mkv
```

The tool validates every reference and sequentially copies each initialization file and its declared fragments into a private temporary track without loading all fragments into memory.

The init and segment files for one track must all be fragmented MP4 (`.m4s`, `.mp4`, `.cmfv`, or `.cmfa`) or all be WebM (`.webm`).

Initialization files containing common fragmented MP4 or WebM encryption markers are rejected before assembly.

Temporary track assembly needs approximately the combined input-track size in free space within the output directory.

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

Use Matroska (`.mkv`) when the selected codecs are not compatible with MP4 or WebM.

Separate-track outputs must contain every requested stream, have a finite positive duration, and keep measurable audio/video start and duration skew within 0.25 seconds before publication.

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
