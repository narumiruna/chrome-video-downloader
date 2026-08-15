import {
  type LocalMergeRequest,
  mergeLocalSegments,
  SegmentMergeError,
} from "./segment-merger";

export interface ParsedMergeArguments {
  help: boolean;
  overwrite: boolean;
  output?: string;
  playlist?: string;
  segments: string[];
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
  if (!isLocalPath(value)) {
    throw new CliUsageError(`${flag} accepts only local filesystem paths.`);
  }
  return value;
}

export const MERGE_USAGE = `Usage:
  npm run merge:segments -- --playlist <local.m3u8> --output <video.mp4> [--overwrite]
  npm run merge:segments -- --segment <part-01.ts> --segment <part-02.ts> --output <video.mp4> [--overwrite]

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
  let output: string | undefined;
  let playlist: string | undefined;
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
    if (argument === "--playlist") {
      if (playlist) throw new CliUsageError("--playlist may be provided once.");
      playlist = nextValue(arguments_, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--segment") {
      segments.push(nextValue(arguments_, index, argument));
      index += 1;
      continue;
    }
    if (argument === "--output") {
      if (output) throw new CliUsageError("--output may be provided once.");
      output = nextValue(arguments_, index, argument);
      index += 1;
      continue;
    }
    throw new CliUsageError(`Unknown argument: ${argument}`);
  }

  if (help) return { help, overwrite, segments };
  if (!playlist && segments.length === 0) {
    throw new CliUsageError("Provide a playlist or at least one segment.");
  }
  if (playlist && segments.length > 0) {
    throw new CliUsageError("Choose either a playlist or ordered segments.");
  }
  if (!output) throw new CliUsageError("Provide an output path.");

  return {
    help,
    overwrite,
    output,
    ...(playlist ? { playlist } : {}),
    segments,
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
      ...(parsed.playlist ? { playlist: parsed.playlist } : {}),
      segments: parsed.segments,
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
