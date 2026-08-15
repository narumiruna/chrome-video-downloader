import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

const MAX_PLAYLIST_BYTES = 1_048_576;
const MAX_MEDIA_REFERENCES = 10_000;
const MAX_URI_LENGTH = 8_192;

export type SegmentMergeErrorCode =
  | "encrypted-input"
  | "invalid-input"
  | "live-input"
  | "master-playlist"
  | "merge-failed"
  | "missing-input"
  | "output-exists"
  | "path-escape"
  | "remote-input"
  | "verification-failed";

export class SegmentMergeError extends Error {
  constructor(
    public readonly code: SegmentMergeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SegmentMergeError";
  }
}

export interface ValidatedHlsPlaylist {
  playlistPath: string;
  mediaPaths: string[];
  sanitizedContent: string;
}

export interface LocalMergeRequest {
  output: string;
  overwrite: boolean;
  playlist?: string;
  segments: string[];
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

export interface MergeDependencies {
  ffmpegPath?: string;
  ffprobePath?: string;
  runCommand?: CommandRunner;
  signal?: AbortSignal;
}

export interface MergeResult {
  outputPath: string;
  streamTypes: string[];
}

async function requireRegularFile(
  path: string,
  missingMessage: string,
): Promise<string> {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(path);
    const file = await stat(canonicalPath);
    if (!file.isFile()) {
      throw new SegmentMergeError(
        "invalid-input",
        `${path} is not a regular file.`,
      );
    }
  } catch (error) {
    if (error instanceof SegmentMergeError) throw error;
    throw new SegmentMergeError("missing-input", missingMessage);
  }
  return canonicalPath;
}

function isInside(directory: string, path: string): boolean {
  return path.startsWith(`${directory}${sep}`);
}

async function rejectNestedManifest(path: string): Promise<void> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(4_096);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const header = buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .trimStart();
    if (
      header.startsWith("#EXTM3U") ||
      header.startsWith("ffconcat version") ||
      /^(?:<\?xml[^>]*>\s*)?<MPD[\s>]/i.test(header)
    ) {
      throw new SegmentMergeError(
        "invalid-input",
        "Nested media playlists and concat manifests are not accepted as segments.",
      );
    }
  } finally {
    await file.close();
  }
}

function decodeLocalUri(uri: string): string {
  if (
    uri.length === 0 ||
    uri.length > MAX_URI_LENGTH ||
    hasControlCharacters(uri)
  ) {
    throw new SegmentMergeError(
      "invalid-input",
      "The playlist contains an invalid URI.",
    );
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    throw new SegmentMergeError(
      "invalid-input",
      "The playlist contains a malformed URI.",
    );
  }
  if (hasControlCharacters(decoded)) {
    throw new SegmentMergeError(
      "invalid-input",
      "The playlist contains an invalid URI.",
    );
  }
  if (
    isAbsolute(decoded) ||
    /^[\\/]{2}/.test(decoded) ||
    /^[a-z][a-z\d+.-]*:/i.test(decoded)
  ) {
    throw new SegmentMergeError(
      "remote-input",
      "The playlist may reference only relative local files.",
    );
  }
  if (
    decoded.includes("?") ||
    decoded.includes("#") ||
    decoded.includes("\\")
  ) {
    throw new SegmentMergeError(
      "remote-input",
      "Playlist URIs may not contain query strings, fragments, or backslashes.",
    );
  }
  return decoded;
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

export async function validateLocalHlsPlaylist(
  playlistPath: string,
): Promise<ValidatedHlsPlaylist> {
  const absolutePlaylistPath = resolve(playlistPath);
  const canonicalPlaylistPath = await requireRegularFile(
    absolutePlaylistPath,
    `Playlist not found: ${playlistPath}`,
  );
  const playlistFile = await stat(canonicalPlaylistPath);
  if (playlistFile.size > MAX_PLAYLIST_BYTES) {
    throw new SegmentMergeError("invalid-input", "The playlist is too large.");
  }

  const content = await readFile(canonicalPlaylistPath, "utf8");
  const lines = content
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
    lines.some(
      (line) =>
        /^#EXT-X-(?:SESSION-)?KEY:/i.test(line) &&
        !/METHOD=NONE(?:,|$)/i.test(line),
    )
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
  if (segmentCount === 0 || uris.length > MAX_MEDIA_REFERENCES) {
    throw new SegmentMergeError(
      "invalid-input",
      "The playlist has no segments or too many media references.",
    );
  }

  const root = await realpath(dirname(canonicalPlaylistPath));
  const mediaPaths: string[] = [];
  const resolvedUris: string[] = [];
  for (const uri of uris) {
    const candidatePath = resolve(root, decodeLocalUri(uri));
    if (!isInside(root, candidatePath)) {
      throw new SegmentMergeError(
        "path-escape",
        "A playlist reference escapes the playlist directory.",
      );
    }
    const canonicalMediaPath = await requireRegularFile(
      candidatePath,
      `Referenced media file not found: ${uri}`,
    );
    if (!isInside(root, canonicalMediaPath)) {
      throw new SegmentMergeError(
        "path-escape",
        "A playlist reference escapes the playlist directory through a symlink.",
      );
    }
    await rejectNestedManifest(canonicalMediaPath);
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
    playlistPath: canonicalPlaylistPath,
    mediaPaths,
    sanitizedContent: `${sanitizedContent}\n`,
  };
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isFilesystemPath(path: string): boolean {
  if (
    path.length === 0 ||
    hasControlCharacters(path) ||
    /^[\\/]{2}/.test(path)
  ) {
    return false;
  }
  return !/^[a-z][a-z\d+.-]*:/i.test(path) || /^[a-z]:[\\/]/i.test(path);
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
  if (paths.length === 0 || paths.length > MAX_MEDIA_REFERENCES) {
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
    await rejectNestedManifest(canonicalPath);
    canonicalPaths.push(canonicalPath);
  }
  return canonicalPaths;
}

function escapeConcatPath(path: string): string {
  return path.replaceAll("'", "'\\''");
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

export async function mergeLocalSegments(
  request: LocalMergeRequest,
  dependencies: MergeDependencies = {},
): Promise<MergeResult> {
  if (Boolean(request.playlist) === request.segments.length > 0) {
    throw new SegmentMergeError(
      "invalid-input",
      "Choose either one local HLS playlist or ordered local segments.",
    );
  }
  if (dependencies.signal?.aborted) {
    throw new SegmentMergeError("merge-failed", "The merge was cancelled.");
  }

  const output = await validateOutput(request.output, request.overwrite);
  const source = request.playlist
    ? await validateLocalHlsPlaylist(request.playlist)
    : { mediaPaths: await validateExplicitSegments(request.segments) };
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
  const sanitizedPlaylist = request.playlist
    ? join(dirname(output.path), `.playlist-${randomUUID()}.m3u8`)
    : undefined;
  const concatManifest = request.playlist
    ? undefined
    : join(dirname(output.path), `.segments-${randomUUID()}.ffconcat`);

  try {
    if (sanitizedPlaylist && "sanitizedContent" in source) {
      await writeFile(sanitizedPlaylist, source.sanitizedContent, {
        flag: "wx",
        mode: 0o600,
      });
    }
    if (concatManifest) {
      const entries = source.mediaPaths
        .map((path) => `file '${escapeConcatPath(path)}'`)
        .join("\n");
      await writeFile(concatManifest, `ffconcat version 1.0\n${entries}\n`, {
        flag: "wx",
        mode: 0o600,
      });
    }

    const inputArguments = sanitizedPlaylist
      ? ["-protocol_whitelist", "file", "-i", sanitizedPlaylist]
      : [
          "-f",
          "concat",
          "-safe",
          "0",
          "-protocol_whitelist",
          "file",
          "-i",
          concatManifest as string,
        ];
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
          "-map",
          "0",
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
          "stream=codec_type",
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
    const streamTypes = Array.isArray((probe as { streams?: unknown }).streams)
      ? (probe as { streams: Array<{ codec_type?: unknown }> }).streams
          .map((stream) => stream.codec_type)
          .filter(
            (type): type is string => type === "audio" || type === "video",
          )
      : [];
    if (streamTypes.length === 0) {
      throw new SegmentMergeError(
        "verification-failed",
        "The merged output has no audio or video streams.",
      );
    }

    if (dependencies.signal?.aborted) {
      throw new SegmentMergeError("merge-failed", "The merge was cancelled.");
    }
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
    if (concatManifest) {
      await rm(concatManifest, { force: true }).catch(() => undefined);
    }
    if (sanitizedPlaylist) {
      await rm(sanitizedPlaylist, { force: true }).catch(() => undefined);
    }
  }
}
