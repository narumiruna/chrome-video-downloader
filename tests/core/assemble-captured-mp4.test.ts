// @vitest-environment node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BlobSource, Input, MP4 } from "mediabunny";
import { describe, expect, test, vi } from "vitest";
import {
  assembleCapturedMp4,
  type CapturedMediaRequest,
} from "../../src/core/assemble-captured-mp4";

const fixtureRoot = join(
  process.cwd(),
  "tests",
  "fixtures",
  "local-streams",
  "dash",
);

function request(
  filename: string,
  mimeType: "audio/mp4" | "video/mp4",
  timestamp: number,
): CapturedMediaRequest {
  return {
    mimeType,
    timestamp,
    url: `https://media.example/${filename}`,
  };
}

async function fixture(filename: string): Promise<ArrayBuffer> {
  const bytes = await readFile(join(fixtureRoot, filename));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

describe("assembleCapturedMp4", () => {
  test("sorts fragmented tracks and remuxes video plus audio into one MP4", async () => {
    const requests = [
      request("chunk-stream0-00002.m4s", "video/mp4", 5),
      request("init-stream1.m4s", "audio/mp4", 2),
      request("chunk-stream1-00003.m4s", "audio/mp4", 7),
      request("init-stream0.m4s", "video/mp4", 1),
      request("chunk-stream0-00001.m4s", "video/mp4", 3),
      request("chunk-stream1-00002.m4s", "audio/mp4", 6),
      request("chunk-stream1-00001.m4s", "audio/mp4", 4),
    ];
    const onProgress = vi.fn();

    const result = await assembleCapturedMp4(requests, {
      fetchPart: async ({ url }) => fixture(url.split("/").at(-1) ?? ""),
      onProgress,
    });

    expect(result.type).toBe("video/mp4");
    expect(result.size).toBeGreaterThan(0);
    const output = new Input({
      formats: [MP4],
      source: new BlobSource(result),
    });
    expect(
      (await output.getTracks()).map((track) => track.type).sort(),
    ).toEqual(["audio", "video"]);
    expect(await output.computeDuration()).toBeGreaterThan(2);
    expect(onProgress).toHaveBeenLastCalledWith({
      phase: "muxing",
      completed: 1,
      total: 1,
    });
    output.dispose();
  });

  test("requires initialization data for each captured track", async () => {
    const requests = [
      request("init-stream0.m4s", "video/mp4", 1),
      request("chunk-stream0-00001.m4s", "video/mp4", 2),
      request("chunk-stream1-00001.m4s", "audio/mp4", 3),
    ];

    await expect(
      assembleCapturedMp4(requests, {
        fetchPart: async ({ url }) => fixture(url.split("/").at(-1) ?? ""),
      }),
    ).rejects.toThrow("audio initialization segment was not captured");
  });

  test("deduplicates identical URL and range requests", async () => {
    const videoInit = request("init-stream0.m4s", "video/mp4", 1);
    const videoPart = {
      ...request("chunk-stream0-00001.m4s", "video/mp4", 2),
      range: "bytes=0-99",
    };
    const fetchPart = vi.fn(async ({ url }: CapturedMediaRequest) =>
      fixture(url.split("/").at(-1) ?? ""),
    );

    await assembleCapturedMp4(
      [videoInit, videoPart, { ...videoPart, timestamp: 3 }],
      { fetchPart },
    );

    expect(fetchPart).toHaveBeenCalledTimes(2);
  });
});
