import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = await mkdtemp(join(tmpdir(), "segment-merger-integration-"));
const playlist = resolve("e2e/fixtures/manifests/hls/sample.m3u8");
const segment = resolve("e2e/fixtures/manifests/hls/segment-00.ts");

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

function merge(arguments_) {
  execute(process.execPath, [
    "--import",
    "tsx",
    "scripts/merge-segments.ts",
    ...arguments_,
  ]);
}

function probe(path) {
  return JSON.parse(
    execute("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name:format=duration",
      "-of",
      "json",
      path,
    ]),
  );
}

function assertVideo(result, expectedDuration) {
  if (!result.streams?.some((stream) => stream.codec_type === "video")) {
    throw new Error("Merged output has no video stream.");
  }
  const duration = Number(result.format?.duration);
  if (
    !Number.isFinite(duration) ||
    Math.abs(duration - expectedDuration) > 0.05
  ) {
    throw new Error(
      `Expected duration ${expectedDuration}, received ${result.format?.duration}.`,
    );
  }
}

try {
  execute("ffmpeg", ["-version"]);
  execute("ffprobe", ["-version"]);

  const hlsOutput = join(root, "hls.mp4");
  merge(["--playlist", playlist, "--output", hlsOutput]);
  assertVideo(probe(hlsOutput), 1);

  const segmentsOutput = join(root, "segments.mp4");
  merge([
    "--segment",
    segment,
    "--segment",
    segment,
    "--output",
    segmentsOutput,
  ]);
  assertVideo(probe(segmentsOutput), 2);

  console.log(
    "Local segment merger integration passed: HLS 1.0s, ordered segments 2.0s.",
  );
} finally {
  await rm(root, { force: true, recursive: true });
}
