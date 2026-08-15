import {
  type LocalMergeRequest,
  mergeLocalSegments,
  SegmentMergeError,
} from "./segment-merger";

export interface ParsedMergeArguments {
  audioPlaylist?: string;
  audioRepresentation?: string;
  dash?: string;
  help: boolean;
  overwrite: boolean;
  output?: string;
  playlist?: string;
  segments: string[];
  tracks?: string;
  videoPlaylist?: string;
  videoRepresentation?: string;
}

export class CliUsageError extends Error {
  override name = "CliUsageError";
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isLocalPath(path: string): boolean {
  if (path.length === 0 || hasControlCharacters(path)) return false;
  if (/^[\\/]{2}/.test(path)) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) {
    return false;
  }
  return true;
}

function nextValue(arguments_: string[], index: number, flag: string): string {
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) {
    throw new CliUsageError(`${flag} requires a value.`);
  }
  return value;
}

function nextPath(arguments_: string[], index: number, flag: string): string {
  const value = nextValue(arguments_, index, flag);
  if (!isLocalPath(value)) {
    throw new CliUsageError(`${flag} accepts only local filesystem paths.`);
  }
  return value;
}

function nextIdentifier(
  arguments_: string[],
  index: number,
  flag: string,
): string {
  const value = nextValue(arguments_, index, flag);
  if (value.length > 256 || hasControlCharacters(value)) {
    throw new CliUsageError(`${flag} requires a valid representation ID.`);
  }
  return value;
}

export const MERGE_USAGE = `Usage:
  npm run merge:segments -- --playlist <local.m3u8> --output <video.mp4> [--overwrite]
  npm run merge:segments -- --segment <part-01.ts> --segment <part-02.ts> --output <video.mp4> [--overwrite]
  npm run merge:segments -- --video-playlist <video.m3u8> --audio-playlist <audio.m3u8> --output <video.mp4> [--overwrite]
  npm run merge:segments -- --dash <local.mpd> [--video-representation <id>] [--audio-representation <id>] --output <video.mkv> [--overwrite]
  npm run merge:segments -- --tracks <local.json> --output <video.mkv> [--overwrite]

Only finite, unencrypted, local media is accepted. Network URLs are rejected.`;

export interface MergeCliIo {
  error(message: string): void;
  log(message: string): void;
}

export interface MergeCliDependencies {
  merge?: typeof mergeLocalSegments;
  signal?: AbortSignal;
}

export function parseMergeArguments(
  arguments_: string[],
): ParsedMergeArguments {
  let audioPlaylist: string | undefined;
  let audioRepresentation: string | undefined;
  let dash: string | undefined;
  let output: string | undefined;
  let playlist: string | undefined;
  let tracks: string | undefined;
  let videoPlaylist: string | undefined;
  let videoRepresentation: string | undefined;
  let overwrite = false;
  let help = false;
  const segments: string[] = [];

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--overwrite") {
      overwrite = true;
      continue;
    }
    if (argument === "--segment") {
      segments.push(nextPath(arguments_, index, argument));
      index += 1;
      continue;
    }

    const pathFlags = new Map<
      string,
      [string | undefined, (value: string) => void]
    >([
      ["--playlist", [playlist, (value) => (playlist = value)]],
      ["--video-playlist", [videoPlaylist, (value) => (videoPlaylist = value)]],
      ["--audio-playlist", [audioPlaylist, (value) => (audioPlaylist = value)]],
      ["--dash", [dash, (value) => (dash = value)]],
      ["--tracks", [tracks, (value) => (tracks = value)]],
      ["--output", [output, (value) => (output = value)]],
    ]);
    const pathFlag = pathFlags.get(argument);
    if (pathFlag) {
      if (pathFlag[0]) {
        throw new CliUsageError(`${argument} may be provided once.`);
      }
      pathFlag[1](nextPath(arguments_, index, argument));
      index += 1;
      continue;
    }

    if (
      argument === "--video-representation" ||
      argument === "--audio-representation"
    ) {
      const current =
        argument === "--video-representation"
          ? videoRepresentation
          : audioRepresentation;
      if (current) {
        throw new CliUsageError(`${argument} may be provided once.`);
      }
      const value = nextIdentifier(arguments_, index, argument);
      if (argument === "--video-representation") videoRepresentation = value;
      else audioRepresentation = value;
      index += 1;
      continue;
    }
    throw new CliUsageError(`Unknown argument: ${argument}`);
  }

  if (help) return { help, overwrite, segments };
  if (Boolean(videoPlaylist) !== Boolean(audioPlaylist)) {
    throw new CliUsageError(
      "Provide both --video-playlist and --audio-playlist.",
    );
  }
  if ((videoRepresentation || audioRepresentation) && !dash) {
    throw new CliUsageError("Representation selectors require --dash.");
  }
  const modeCount = [
    Boolean(playlist),
    segments.length > 0,
    Boolean(videoPlaylist && audioPlaylist),
    Boolean(dash),
    Boolean(tracks),
  ].filter(Boolean).length;
  if (modeCount === 0) {
    throw new CliUsageError("Provide a playlist or at least one segment.");
  }
  if (modeCount > 1) {
    throw new CliUsageError("Choose either one input mode, not multiple.");
  }
  if (!output) throw new CliUsageError("Provide an output path.");

  return {
    help,
    overwrite,
    output,
    segments,
    ...(playlist ? { playlist } : {}),
    ...(videoPlaylist ? { videoPlaylist } : {}),
    ...(audioPlaylist ? { audioPlaylist } : {}),
    ...(dash ? { dash } : {}),
    ...(tracks ? { tracks } : {}),
    ...(videoRepresentation ? { videoRepresentation } : {}),
    ...(audioRepresentation ? { audioRepresentation } : {}),
  };
}

export async function runMergeCli(
  arguments_: string[],
  io: MergeCliIo,
  dependencies: MergeCliDependencies = {},
): Promise<number> {
  let parsed: ParsedMergeArguments;
  try {
    parsed = parseMergeArguments(arguments_);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid arguments.";
    io.error(`${message}\n\n${MERGE_USAGE}`);
    return 2;
  }
  if (parsed.help) {
    io.log(MERGE_USAGE);
    return 0;
  }

  try {
    const request: LocalMergeRequest = {
      output: parsed.output as string,
      overwrite: parsed.overwrite,
      segments: parsed.segments,
      ...(parsed.playlist ? { playlist: parsed.playlist } : {}),
      ...(parsed.videoPlaylist ? { videoPlaylist: parsed.videoPlaylist } : {}),
      ...(parsed.audioPlaylist ? { audioPlaylist: parsed.audioPlaylist } : {}),
      ...(parsed.dash ? { dash: parsed.dash } : {}),
      ...(parsed.tracks ? { tracks: parsed.tracks } : {}),
      ...(parsed.videoRepresentation
        ? { videoRepresentation: parsed.videoRepresentation }
        : {}),
      ...(parsed.audioRepresentation
        ? { audioRepresentation: parsed.audioRepresentation }
        : {}),
    };
    const result = await (dependencies.merge ?? mergeLocalSegments)(request, {
      signal: dependencies.signal,
    });
    io.log(
      `Merged ${result.streamTypes.join(" + ")} into ${result.outputPath}`,
    );
    return 0;
  } catch (error) {
    const message =
      error instanceof SegmentMergeError
        ? `${error.code}: ${error.message}`
        : "merge-failed: The merge failed unexpectedly.";
    io.error(message);
    return 1;
  }
}
