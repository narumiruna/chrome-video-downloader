import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  type FileHandle,
  link,
  lstat,
  open,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ValidatedAdaptiveTrack,
  validateLocalDashManifest,
  validateLocalTrackManifest,
} from "./adaptive-input";
import {
  hasControlCharacters,
  isFilesystemPath,
  MAX_LOCAL_REFERENCES,
  readBoundedLocalFile,
  rejectManifestLikeFile,
  requireRegularFile,
  resolveLocalReference,
} from "./local-files";
import { SegmentMergeError } from "./merge-errors";

export { SegmentMergeError } from "./merge-errors";

export interface ValidatedHlsPlaylist {
  playlistPath: string;
  mediaPaths: string[];
  sanitizedContent: string;
}

export interface LocalMergeRequest {
  audioPlaylist?: string;
  audioRepresentation?: string;
  dash?: string;
  output: string;
  overwrite: boolean;
  playlist?: string;
  segments: string[];
  tracks?: string;
  videoPlaylist?: string;
  videoRepresentation?: string;
}

export interface CommandResult {
  stderr: string;
  stdout: string;
}

export type CommandRunner = (
  command: string,
  arguments_: string[],
  signal?: AbortSignal,
) => Promise<CommandResult>;

export type TrackChunkWriter = (
  target: FileHandle,
  buffer: Buffer,
  offset: number,
  length: number,
) => Promise<number>;

export interface MergeDependencies {
  ffmpegPath?: string;
  ffprobePath?: string;
  runCommand?: CommandRunner;
  signal?: AbortSignal;
  writeTrackChunk?: TrackChunkWriter;
}

export interface MergeResult {
  outputPath: string;
  streamTypes: string[];
}

function playlistUris(lines: string[]): {
  segmentCount: number;
  uris: string[];
} {
  const uris: string[] = [];
  let segmentCount = 0;
  for (const line of lines) {
    if (line.length === 0) continue;
    if (!line.startsWith("#")) {
      uris.push(line);
      segmentCount += 1;
      continue;
    }
    const uriAttribute = /(?:^|[:,])URI=(?:"([^"]*)"|([^,\s]*))/i.exec(line);
    const uri = uriAttribute?.[1] ?? uriAttribute?.[2];
    if (uri !== undefined) uris.push(uri);
  }
  return { segmentCount, uris };
}

function hlsAttributeValues(line: string, name: string): string[] {
  const attributes = line.slice(line.indexOf(":") + 1);
  const parts: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index <= attributes.length; index += 1) {
    const character = attributes[index];
    if (character === '"') quoted = !quoted;
    if ((character === "," && !quoted) || index === attributes.length) {
      parts.push(attributes.slice(start, index));
      start = index + 1;
    }
  }
  return parts
    .map((part) => part.split("=", 2))
    .filter(([key, value]) => key?.trim().toUpperCase() === name && value)
    .map(([, value]) => value?.trim() as string);
}

export async function validateLocalHlsPlaylist(
  playlistPath: string,
): Promise<ValidatedHlsPlaylist> {
  const playlist = await readBoundedLocalFile(playlistPath, "Playlist");
  const lines = playlist.content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  if (lines.find((line) => line.length > 0) !== "#EXTM3U") {
    throw new SegmentMergeError(
      "invalid-input",
      "The input is not an HLS playlist.",
    );
  }
  if (
    lines.some((line) => {
      if (!/^#EXT-X-(?:SESSION-)?KEY:/i.test(line)) return false;
      const methods = hlsAttributeValues(line, "METHOD");
      return methods.length !== 1 || methods[0]?.toUpperCase() !== "NONE";
    })
  ) {
    throw new SegmentMergeError(
      "encrypted-input",
      "Encrypted playlists are not supported.",
    );
  }
  if (lines.some((line) => /^#EXT-X-DEFINE:/i.test(line))) {
    throw new SegmentMergeError(
      "invalid-input",
      "Playlist variable substitution is not supported.",
    );
  }
  if (
    lines.some((line) =>
      /^#EXT-X-(?:STREAM-INF|I-FRAME-STREAM-INF|MEDIA):/i.test(line),
    )
  ) {
    throw new SegmentMergeError(
      "master-playlist",
      "Master playlists are not supported; provide a local media playlist.",
    );
  }
  if (!lines.some((line) => /^#EXT-X-ENDLIST\s*$/i.test(line))) {
    throw new SegmentMergeError(
      "live-input",
      "Live or incomplete playlists are not supported.",
    );
  }

  const { segmentCount, uris } = playlistUris(lines);
  if (segmentCount === 0 || uris.length > MAX_LOCAL_REFERENCES) {
    throw new SegmentMergeError(
      "invalid-input",
      "The playlist has no segments or too many media references.",
    );
  }

  const mediaPaths: string[] = [];
  const resolvedUris: string[] = [];
  for (const uri of uris) {
    const canonicalMediaPath = await resolveLocalReference(playlist.root, uri);
    await rejectManifestLikeFile(canonicalMediaPath);
    resolvedUris.push(canonicalMediaPath);
    if (!mediaPaths.includes(canonicalMediaPath))
      mediaPaths.push(canonicalMediaPath);
  }

  let uriIndex = 0;
  const sanitizedContent = lines
    .map((line) => {
      if (line.length === 0) return line;
      if (!line.startsWith("#")) {
        const uri = pathToFileURL(resolvedUris[uriIndex]).href;
        uriIndex += 1;
        return uri;
      }
      return line.replace(
        /((?:^|[:,])URI=)(?:"[^"]*"|[^,\s]*)/i,
        (_match, prefix: string) => {
          const uri = pathToFileURL(resolvedUris[uriIndex]).href;
          uriIndex += 1;
          return `${prefix}"${uri}"`;
        },
      );
    })
    .join("\n");

  return {
    playlistPath: playlist.path,
    mediaPaths,
    sanitizedContent: `${sanitizedContent}\n`,
  };
}

function boundedText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return [...text]
    .map((character) => (hasControlCharacters(character) ? " " : character))
    .join("")
    .slice(-8_192)
    .trim();
}

export const runCommand: CommandRunner = (command, arguments_, signal) =>
  new Promise((resolveCommand, rejectCommand) => {
    if (signal?.aborted) {
      rejectCommand(
        new SegmentMergeError("merge-failed", "The merge was cancelled."),
      );
      return;
    }
    const child = spawn(command, arguments_, {
      signal,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let stdout = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString("utf8")}`.slice(0, 1_048_576);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16_384);
    });
    child.once("error", (error) => {
      finish(() => {
        const message =
          error.name === "AbortError"
            ? "The merge was cancelled."
            : `Could not start ${basename(command)}: ${boundedText(error)}`;
        rejectCommand(new SegmentMergeError("merge-failed", message));
      });
    });
    child.once("close", (code, processSignal) => {
      finish(() => {
        if (code === 0) {
          resolveCommand({ stderr, stdout });
          return;
        }
        const detail =
          boundedText(stderr) || `signal ${processSignal ?? "unknown"}`;
        rejectCommand(
          new SegmentMergeError(
            "merge-failed",
            `${basename(command)} exited with status ${code ?? "unknown"}: ${detail}`,
          ),
        );
      });
    });
  });

async function fileExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function validateOutput(
  output: string,
  overwrite: boolean,
): Promise<{ exists: boolean; path: string }> {
  if (hasControlCharacters(output)) {
    throw new SegmentMergeError(
      "invalid-input",
      "The output path contains control characters.",
    );
  }
  if (!isFilesystemPath(output)) {
    throw new SegmentMergeError(
      "remote-input",
      "The output must be a local filesystem path.",
    );
  }
  if (
    ![".m4v", ".mkv", ".mov", ".mp4", ".ts", ".webm"].includes(
      extname(output).toLowerCase(),
    )
  ) {
    throw new SegmentMergeError(
      "invalid-input",
      "Use a single-file output extension: .mp4, .m4v, .mov, .mkv, .webm, or .ts.",
    );
  }
  let outputDirectory: string;
  try {
    outputDirectory = await realpath(dirname(resolve(output)));
    if (!(await stat(outputDirectory)).isDirectory())
      throw new Error("not a directory");
  } catch {
    throw new SegmentMergeError(
      "missing-input",
      "The output directory does not exist.",
    );
  }
  const path = join(outputDirectory, basename(output));
  const exists = await fileExists(path);
  if (exists && !(await lstat(path)).isFile()) {
    throw new SegmentMergeError(
      "invalid-input",
      "An existing output must be a regular file.",
    );
  }
  if (exists && !overwrite) {
    throw new SegmentMergeError(
      "output-exists",
      "The output already exists; pass --overwrite to replace it.",
    );
  }
  return { exists, path };
}

async function validateExplicitSegments(paths: string[]): Promise<string[]> {
  if (paths.length === 0 || paths.length > MAX_LOCAL_REFERENCES) {
    throw new SegmentMergeError(
      "invalid-input",
      "Provide between 1 and 10,000 ordered segment files.",
    );
  }
  const canonicalPaths: string[] = [];
  for (const path of paths) {
    if (hasControlCharacters(path)) {
      throw new SegmentMergeError(
        "invalid-input",
        "Segment paths may not contain control characters.",
      );
    }
    if (!isFilesystemPath(path)) {
      throw new SegmentMergeError(
        "remote-input",
        "Segments must be local filesystem paths.",
      );
    }
    const canonicalPath = await requireRegularFile(
      resolve(path),
      `Segment not found: ${path}`,
    );
    await rejectManifestLikeFile(canonicalPath);
    canonicalPaths.push(canonicalPath);
  }
  return canonicalPaths;
}

function escapeConcatPath(path: string): string {
  return path.replaceAll("'", "'\\''");
}

async function writePrivateTemporary(
  path: string,
  content: string,
): Promise<void> {
  try {
    await writeFile(path, content, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      await rm(path, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

function temporaryOutputPath(outputPath: string): string {
  const extension = extname(outputPath);
  return join(
    dirname(outputPath),
    `.${basename(outputPath)}.merge-${randomUUID()}${extension}`,
  );
}

async function publishOutput(
  temporaryPath: string,
  outputPath: string,
  outputExists: boolean,
): Promise<void> {
  if (!outputExists) {
    try {
      await link(temporaryPath, outputPath);
      await rm(temporaryPath, { force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new SegmentMergeError(
          "output-exists",
          "The output was created while the merge was running and was preserved.",
        );
      }
      throw error;
    }
  }

  try {
    await rename(temporaryPath, outputPath);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EEXIST", "EPERM"].includes(code ?? "")) throw error;
  }

  if (!(await lstat(outputPath)).isFile()) {
    throw new SegmentMergeError(
      "invalid-input",
      "The output changed to a non-file while the merge was running.",
    );
  }
  const backupPath = `${outputPath}.merge-backup-${randomUUID()}`;
  await rename(outputPath, backupPath);
  try {
    await rename(temporaryPath, outputPath);
    await rm(backupPath, { force: true });
  } catch (error) {
    await rename(backupPath, outputPath).catch(() => undefined);
    throw error;
  }
}

function normalizeFailure(
  code: "merge-failed" | "verification-failed",
  label: string,
  error: unknown,
): SegmentMergeError {
  if (
    error instanceof SegmentMergeError &&
    error.message === "The merge was cancelled."
  ) {
    return error;
  }
  return new SegmentMergeError(
    code,
    `${label}: ${boundedText(error) || "unknown error"}`,
  );
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new SegmentMergeError("merge-failed", "The merge was cancelled.");
  }
}

type ValidatedMergeSource =
  | {
      mediaPaths: string[];
      mode: "segments";
    }
  | {
      mediaPaths: string[];
      mode: "single-playlist";
      playlists: ValidatedHlsPlaylist[];
    }
  | {
      mediaPaths: string[];
      mode: "paired-playlists";
      playlists: ValidatedHlsPlaylist[];
      trackKinds: Array<"audio" | "video">;
    }
  | {
      mediaPaths: string[];
      mode: "adaptive-tracks";
      tracks: ValidatedAdaptiveTrack[];
    };

async function validateMergeSource(
  request: LocalMergeRequest,
): Promise<ValidatedMergeSource> {
  if (Boolean(request.videoPlaylist) !== Boolean(request.audioPlaylist)) {
    throw new SegmentMergeError(
      "invalid-input",
      "Provide both local video and audio playlists.",
    );
  }
  if (
    (request.videoRepresentation || request.audioRepresentation) &&
    !request.dash
  ) {
    throw new SegmentMergeError(
      "invalid-input",
      "Representation selectors require a DASH manifest.",
    );
  }
  const pairedPlaylists = Boolean(
    request.videoPlaylist && request.audioPlaylist,
  );
  const modeCount = [
    Boolean(request.playlist),
    request.segments.length > 0,
    pairedPlaylists,
    Boolean(request.dash),
    Boolean(request.tracks),
  ].filter(Boolean).length;
  if (modeCount !== 1) {
    throw new SegmentMergeError(
      "invalid-input",
      "Choose either one local playlist, ordered segments, paired playlists, DASH, or a track manifest.",
    );
  }

  if (request.playlist) {
    const playlist = await validateLocalHlsPlaylist(request.playlist);
    return {
      mediaPaths: playlist.mediaPaths,
      mode: "single-playlist",
      playlists: [playlist],
    };
  }
  if (request.segments.length > 0) {
    return {
      mediaPaths: await validateExplicitSegments(request.segments),
      mode: "segments",
    };
  }
  if (request.videoPlaylist && request.audioPlaylist) {
    const playlists = [
      await validateLocalHlsPlaylist(request.videoPlaylist),
      await validateLocalHlsPlaylist(request.audioPlaylist),
    ];
    return {
      mediaPaths: playlists.flatMap((playlist) => playlist.mediaPaths),
      mode: "paired-playlists",
      playlists,
      trackKinds: ["video", "audio"],
    };
  }
  const adaptive = request.dash
    ? await validateLocalDashManifest(request.dash, {
        ...(request.videoRepresentation
          ? { videoRepresentation: request.videoRepresentation }
          : {}),
        ...(request.audioRepresentation
          ? { audioRepresentation: request.audioRepresentation }
          : {}),
      })
    : await validateLocalTrackManifest(request.tracks as string);
  return {
    mediaPaths: adaptive.tracks.flatMap((track) => [
      track.initPath,
      ...track.segmentPaths,
    ]),
    mode: "adaptive-tracks",
    tracks: adaptive.tracks,
  };
}

const writeTrackChunk: TrackChunkWriter = async (
  target,
  buffer,
  offset,
  length,
) => (await target.write(buffer, offset, length)).bytesWritten;

async function assembleTrack(
  track: ValidatedAdaptiveTrack,
  outputDirectory: string,
  signal?: AbortSignal,
  writeChunk: TrackChunkWriter = writeTrackChunk,
): Promise<string> {
  const assembledPath = join(
    outputDirectory,
    `.track-${track.kind}-${randomUUID()}${track.temporaryExtension}`,
  );
  const target = await open(assembledPath, "wx", 0o600);
  let failure: unknown;
  try {
    for (const sourcePath of [track.initPath, ...track.segmentPaths]) {
      throwIfCancelled(signal);
      try {
        for await (const chunk of createReadStream(sourcePath, { signal })) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          let offset = 0;
          while (offset < buffer.byteLength) {
            throwIfCancelled(signal);
            const bytesWritten = await writeChunk(
              target,
              buffer,
              offset,
              buffer.byteLength - offset,
            );
            if (bytesWritten === 0) {
              throw new Error("The assembled track write made no progress.");
            }
            offset += bytesWritten;
          }
        }
      } catch (error) {
        throwIfCancelled(signal);
        throw error;
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      await target.close();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) {
    await rm(assembledPath, { force: true }).catch(() => undefined);
    throw failure;
  }
  return assembledPath;
}

function mapArguments(trackKinds?: Array<"audio" | "video">): string[] {
  if (!trackKinds) return ["-map", "0"];
  return trackKinds.flatMap((kind, index) => ["-map", `${index}:${kind[0]}:0`]);
}

interface ProbeStream {
  codec_name?: unknown;
  codec_type?: unknown;
  duration?: unknown;
  start_time?: unknown;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function verifyProbe(
  probe: unknown,
  expectedTypes?: Array<"audio" | "video">,
): string[] {
  if (!probe || typeof probe !== "object") {
    throw new SegmentMergeError(
      "verification-failed",
      "FFprobe returned an invalid result.",
    );
  }
  const rawStreams = (probe as { streams?: unknown }).streams;
  const streams = Array.isArray(rawStreams)
    ? rawStreams.filter(
        (stream): stream is ProbeStream =>
          typeof stream === "object" && stream !== null,
      )
    : [];
  const mediaStreams = streams.filter(
    (stream) => stream.codec_type === "audio" || stream.codec_type === "video",
  );
  if (mediaStreams.length === 0) {
    throw new SegmentMergeError(
      "verification-failed",
      "The merged output has no audio or video streams.",
    );
  }

  if (expectedTypes) {
    if (mediaStreams.length !== expectedTypes.length) {
      throw new SegmentMergeError(
        "verification-failed",
        "The merged output contains an unexpected number of media streams.",
      );
    }
    for (const type of expectedTypes) {
      const matches = mediaStreams.filter(
        (stream) => stream.codec_type === type,
      );
      if (
        matches.length !== 1 ||
        typeof matches[0]?.codec_name !== "string" ||
        matches[0].codec_name.length === 0
      ) {
        throw new SegmentMergeError(
          "verification-failed",
          `The merged output does not contain exactly one verified ${type} stream.`,
        );
      }
    }
    const duration = finiteNumber(
      (probe as { format?: { duration?: unknown } }).format?.duration,
    );
    if (duration === null || duration <= 0) {
      throw new SegmentMergeError(
        "verification-failed",
        "The merged output does not have a finite positive duration.",
      );
    }
    const video = mediaStreams.find((stream) => stream.codec_type === "video");
    const audio = mediaStreams.find((stream) => stream.codec_type === "audio");
    if (video && audio) {
      const videoStart = finiteNumber(video.start_time);
      const audioStart = finiteNumber(audio.start_time);
      if (
        videoStart === null ||
        audioStart === null ||
        Math.abs(videoStart - audioStart) > 0.25
      ) {
        throw new SegmentMergeError(
          "verification-failed",
          "The merged audio and video start times are not synchronized.",
        );
      }
      const videoDuration = finiteNumber(video.duration);
      const audioDuration = finiteNumber(audio.duration);
      if (
        videoDuration !== null &&
        audioDuration !== null &&
        Math.abs(videoDuration - audioDuration) > 0.25
      ) {
        throw new SegmentMergeError(
          "verification-failed",
          "The merged audio and video durations are not synchronized.",
        );
      }
    }
  }

  return mediaStreams.map((stream) => stream.codec_type as "audio" | "video");
}

export async function mergeLocalSegments(
  request: LocalMergeRequest,
  dependencies: MergeDependencies = {},
): Promise<MergeResult> {
  throwIfCancelled(dependencies.signal);
  const source = await validateMergeSource(request);
  const output = await validateOutput(request.output, request.overwrite);
  if (source.mediaPaths.includes(output.path)) {
    throw new SegmentMergeError(
      "invalid-input",
      "The output path must differ from every input path.",
    );
  }

  const execute = dependencies.runCommand ?? runCommand;
  const ffmpegPath = dependencies.ffmpegPath ?? "ffmpeg";
  const ffprobePath = dependencies.ffprobePath ?? "ffprobe";
  const temporaryOutput = temporaryOutputPath(output.path);
  const temporaryInputs: string[] = [];

  try {
    let inputArguments: string[] = [];
    let trackKinds: Array<"audio" | "video"> | undefined;
    if (
      source.mode === "single-playlist" ||
      source.mode === "paired-playlists"
    ) {
      for (const playlist of source.playlists) {
        const temporaryPlaylist = join(
          dirname(output.path),
          `.playlist-${randomUUID()}.m3u8`,
        );
        await writePrivateTemporary(
          temporaryPlaylist,
          playlist.sanitizedContent,
        );
        temporaryInputs.push(temporaryPlaylist);
        inputArguments.push(
          "-protocol_whitelist",
          "file",
          "-i",
          temporaryPlaylist,
        );
      }
      trackKinds =
        source.mode === "paired-playlists" ? source.trackKinds : undefined;
    } else if (source.mode === "segments") {
      const concatManifest = join(
        dirname(output.path),
        `.segments-${randomUUID()}.ffconcat`,
      );
      const entries = source.mediaPaths
        .map((path) => `file '${escapeConcatPath(path)}'`)
        .join("\n");
      await writePrivateTemporary(
        concatManifest,
        `ffconcat version 1.0\n${entries}\n`,
      );
      temporaryInputs.push(concatManifest);
      inputArguments = [
        "-f",
        "concat",
        "-safe",
        "0",
        "-protocol_whitelist",
        "file",
        "-i",
        concatManifest,
      ];
    } else {
      trackKinds = source.tracks.map((track) => track.kind);
      for (const track of source.tracks) {
        let assembledPath: string;
        try {
          assembledPath = await assembleTrack(
            track,
            dirname(output.path),
            dependencies.signal,
            dependencies.writeTrackChunk,
          );
        } catch (error) {
          throw normalizeFailure(
            "merge-failed",
            "Could not assemble a local media track",
            error,
          );
        }
        temporaryInputs.push(assembledPath);
        inputArguments.push("-protocol_whitelist", "file", "-i", assembledPath);
      }
    }

    const movFlags = [".m4v", ".mov", ".mp4"].includes(
      extname(output.path).toLowerCase(),
    )
      ? ["-movflags", "+faststart"]
      : [];
    try {
      await execute(
        ffmpegPath,
        [
          "-hide_banner",
          "-nostdin",
          "-loglevel",
          "error",
          "-y",
          ...inputArguments,
          ...mapArguments(trackKinds),
          "-c",
          "copy",
          ...movFlags,
          temporaryOutput,
        ],
        dependencies.signal,
      );
    } catch (error) {
      throw normalizeFailure(
        "merge-failed",
        "FFmpeg could not merge the input",
        error,
      );
    }

    let probe: unknown;
    try {
      const result = await execute(
        ffprobePath,
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file",
          "-show_entries",
          "stream=codec_type,codec_name,start_time,duration:format=duration",
          "-of",
          "json",
          temporaryOutput,
        ],
        dependencies.signal,
      );
      probe = JSON.parse(result.stdout);
    } catch (error) {
      throw normalizeFailure(
        "verification-failed",
        "FFprobe could not verify the output",
        error,
      );
    }
    const streamTypes = verifyProbe(probe, trackKinds);

    throwIfCancelled(dependencies.signal);
    try {
      await publishOutput(temporaryOutput, output.path, output.exists);
    } catch (error) {
      if (error instanceof SegmentMergeError) throw error;
      throw normalizeFailure(
        "merge-failed",
        "The verified output could not be published",
        error,
      );
    }
    return { outputPath: output.path, streamTypes: [...new Set(streamTypes)] };
  } finally {
    await rm(temporaryOutput, { force: true }).catch(() => undefined);
    await Promise.all(
      temporaryInputs.map((path) =>
        rm(path, { force: true }).catch(() => undefined),
      ),
    );
  }
}
