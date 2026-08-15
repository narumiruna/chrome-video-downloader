import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = await mkdtemp(join(tmpdir(), "segment-merger-integration-"));
const originalPlaylist = resolve("e2e/fixtures/manifests/hls/sample.m3u8");
const originalSegment = resolve("e2e/fixtures/manifests/hls/segment-00.ts");
const adaptiveRoot = resolve("tests/fixtures/local-streams");

function execute(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    maxBuffer: 1_048_576,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.error?.message || "unknown error")
      .slice(-8_192)
      .trim();
    throw new Error(`${command} failed: ${detail}`);
  }
  return result.stdout;
}

function mergeArguments(arguments_) {
  return ["--import", "tsx", "scripts/merge-segments.ts", ...arguments_];
}

function merge(arguments_) {
  execute(process.execPath, mergeArguments(arguments_));
}

function expectMergeFailure(arguments_) {
  const result = spawnSync(process.execPath, mergeArguments(arguments_), {
    encoding: "utf8",
    maxBuffer: 1_048_576,
    timeout: 30_000,
  });
  if (result.error || result.status === 0) {
    throw new Error("Expected the incompatible local merge to fail.");
  }
}

async function verifyFixtureHashes() {
  const checksumFile = await readFile(join(adaptiveRoot, "SHA256SUMS"), "utf8");
  for (const line of checksumFile.trim().split("\n")) {
    const match = /^([a-f\d]{64}) {2}(.+)$/.exec(line);
    if (!match) throw new Error(`Invalid fixture checksum line: ${line}`);
    const content = await readFile(join(adaptiveRoot, match[2]));
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== match[1]) {
      throw new Error(`Fixture checksum mismatch: ${match[2]}`);
    }
  }
}

function probe(path) {
  return JSON.parse(
    execute("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,start_time,duration:format=duration",
      "-of",
      "json",
      path,
    ]),
  );
}

function assertMedia(result, expected) {
  const streams = result.streams ?? [];
  const actual = Object.fromEntries(
    streams.map((stream) => [stream.codec_type, stream.codec_name]),
  );
  if (actual.video !== expected.video) {
    throw new Error(
      `Expected video codec ${expected.video}, received ${actual.video}.`,
    );
  }
  if (expected.audio && actual.audio !== expected.audio) {
    throw new Error(
      `Expected audio codec ${expected.audio}, received ${actual.audio}.`,
    );
  }
  if (!expected.audio && actual.audio) {
    throw new Error(`Expected no audio stream, received ${actual.audio}.`);
  }
  const duration = Number(result.format?.duration);
  if (
    !Number.isFinite(duration) ||
    Math.abs(duration - expected.duration) > 0.05
  ) {
    throw new Error(
      `Expected duration ${expected.duration}, received ${result.format?.duration}.`,
    );
  }
}

try {
  execute("ffmpeg", ["-version"]);
  execute("ffprobe", ["-version"]);
  await verifyFixtureHashes();

  const originalHlsOutput = join(root, "original-hls.mp4");
  merge(["--playlist", originalPlaylist, "--output", originalHlsOutput]);
  assertMedia(probe(originalHlsOutput), { duration: 1, video: "h264" });

  const segmentsOutput = join(root, "segments.mp4");
  merge([
    "--segment",
    originalSegment,
    "--segment",
    originalSegment,
    "--output",
    segmentsOutput,
  ]);
  assertMedia(probe(segmentsOutput), { duration: 2, video: "h264" });

  const pairedHlsOutput = join(root, "paired-hls.mp4");
  merge([
    "--video-playlist",
    join(adaptiveRoot, "hls/video.m3u8"),
    "--audio-playlist",
    join(adaptiveRoot, "hls/audio.m3u8"),
    "--output",
    pairedHlsOutput,
  ]);
  assertMedia(probe(pairedHlsOutput), {
    audio: "aac",
    duration: 2.026667,
    video: "h264",
  });

  const dashOutput = join(root, "dash.mp4");
  merge([
    "--dash",
    join(adaptiveRoot, "dash/presentation.mpd"),
    "--output",
    dashOutput,
  ]);
  assertMedia(probe(dashOutput), {
    audio: "aac",
    duration: 2.005,
    video: "h264",
  });

  const fmp4Output = join(root, "fmp4.mp4");
  merge([
    "--tracks",
    join(adaptiveRoot, "tracks-fmp4.json"),
    "--output",
    fmp4Output,
  ]);
  assertMedia(probe(fmp4Output), {
    audio: "aac",
    duration: 2.005,
    video: "h264",
  });

  const webmOutput = join(root, "webm.webm");
  merge([
    "--tracks",
    join(adaptiveRoot, "tracks-webm.json"),
    "--output",
    webmOutput,
  ]);
  assertMedia(probe(webmOutput), {
    audio: "opus",
    duration: 2.008,
    video: "vp9",
  });

  const incompatibleOutput = join(root, "incompatible.webm");
  expectMergeFailure([
    "--video-playlist",
    join(adaptiveRoot, "hls/video.m3u8"),
    "--audio-playlist",
    join(adaptiveRoot, "hls/audio.m3u8"),
    "--output",
    incompatibleOutput,
  ]);
  try {
    await access(incompatibleOutput);
    throw new Error("An incompatible merge published an output.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const leftovers = (await readdir(root)).filter((name) =>
    name.startsWith("."),
  );
  if (leftovers.length > 0) {
    throw new Error(`Temporary files remain: ${leftovers.join(", ")}`);
  }

  console.log(
    "Local segment merger integration passed: legacy HLS/segments and authorized paired HLS, DASH, fMP4, and WebM tracks.",
  );
} finally {
  await rm(root, { force: true, recursive: true });
}
