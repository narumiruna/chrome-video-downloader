// @vitest-environment node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BlobSource, Input, MP4 } from "mediabunny";
import { describe, expect, test, vi } from "vitest";
import {
  assembleCapturedMp4,
  type CapturedMediaRequest,
} from "../../src/core/assemble-captured-mp4";
import { isCapturedMp4PlaylistMetadata } from "../../src/core/captured-mp4-metadata";

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
  test("recognizes only HTTP(S) JSON playlist metadata", () => {
    expect(
      isCapturedMp4PlaylistMetadata({
        mimeType: "application/json; charset=utf-8",
        url: "https://media.example/path/playlist.json?token=private",
      }),
    ).toBe(true);
    for (const request of [
      { mimeType: "application/json", url: "https://media.example/data.json" },
      {
        mimeType: "text/javascript",
        url: "https://media.example/playlist.json",
      },
      {
        mimeType: "application/json",
        url: "https://user:secret@media.example/playlist.json",
      },
      {
        mimeType: "application/json",
        url: "file:///tmp/playlist.json",
      },
    ]) {
      expect(isCapturedMp4PlaylistMetadata(request)).toBe(false);
    }
  });

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

  test("uses captured playlist metadata when initialization data is embedded", async () => {
    const videoUrl = "https://media.example/chunk-stream0-00001.m4s";
    const secondVideoUrl = "https://media.example/chunk-stream0-00002.m4s";
    const audioUrl = "https://media.example/chunk-stream1-00001.m4s";
    const playlistUrl = "https://media.example/playlist.json";
    const playlist = {
      base_url: "",
      video: [
        {
          base_url: "",
          init_segment: Buffer.from(
            await readFile(join(fixtureRoot, "init-stream1.m4s")),
          ).toString("base64"),
          segments: [
            { url: "chunk-stream0-00001.m4s" },
            { url: "chunk-stream0-00001.m4s" },
            { url: "chunk-stream0-00001.m4s" },
          ],
        },
        {
          base_url: "",
          init_segment: Buffer.from(
            await readFile(join(fixtureRoot, "init-stream0.m4s")),
          ).toString("base64"),
          segments: [
            { url: "chunk-stream0-00001.m4s" },
            { url: "chunk-stream0-00002.m4s" },
          ],
        },
      ],
      audio: [
        {
          base_url: "",
          init_segment: Buffer.from(
            await readFile(join(fixtureRoot, "init-stream1.m4s")),
          ).toString("base64"),
          segments: [{ url: "chunk-stream1-00001.m4s" }],
        },
      ],
    };
    const requests: CapturedMediaRequest[] = [
      {
        mimeType: "application/json; charset=utf-8",
        timestamp: 1,
        url: playlistUrl,
      },
      { mimeType: "video/mp4", timestamp: 2, url: videoUrl },
      { mimeType: "video/mp4", timestamp: 3, url: secondVideoUrl },
      { mimeType: "audio/mp4", timestamp: 4, url: audioUrl },
    ];

    const result = await assembleCapturedMp4(requests, {
      fetchPart: async ({ url }) =>
        url === playlistUrl
          ? new TextEncoder().encode(JSON.stringify(playlist)).buffer
          : fixture(url.split("/").at(-1) ?? ""),
    });

    const output = new Input({
      formats: [MP4],
      source: new BlobSource(result),
    });
    expect(
      (await output.getTracks()).map((track) => track.type).sort(),
    ).toEqual(["audio", "video"]);
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
