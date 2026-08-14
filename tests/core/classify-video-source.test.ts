import { describe, expect, test } from "vitest";
import { classifyVideoSource } from "../../src/core/classify-video-source";

describe("classifyVideoSource", () => {
  test.each([
    ["https://media.example/video.mp4", "", "MP4"],
    ["https://media.example/video.WEBM?token=secret", "", "WEBM"],
    ["https://media.example/play?id=1", "video/mp4", "MP4"],
    ["https://media.example/no-extension", "", "VIDEO"],
  ] as const)("accepts a direct media source", (url, mediaType, format) => {
    expect(classifyVideoSource(url, mediaType, "media-element")).toEqual({
      format,
      sourceType: "direct",
      status: "downloadable",
    });
  });

  test.each([
    ["https://media.example/master.m3u8", "", "HLS", "hls"],
    [
      "https://media.example/play",
      "application/vnd.apple.mpegurl",
      "HLS",
      "hls",
    ],
    ["https://media.example/manifest.mpd", "", "DASH", "dash"],
    ["https://media.example/play", "application/dash+xml", "DASH", "dash"],
    ["blob:https://example.com/id", "video/mp4", "BLOB", "blob"],
    ["mediastream:", "", "LIVE", "media-stream"],
  ] as const)(
    "marks stream containers as unsupported",
    (url, mediaType, format, sourceType) => {
      expect(classifyVideoSource(url, mediaType, "media-element")).toEqual({
        format,
        sourceType,
        status: "unsupported",
      });
    },
  );

  test.each([
    "https://media.example/segment.ts",
    "https://media.example/chunk.m4s?part=3",
    "https://media.example/audio.aac",
  ])("rejects individual stream segments", (url) => {
    expect(classifyVideoSource(url, "", "performance")).toBeNull();
  });

  test("rejects an unrelated performance resource", () => {
    expect(
      classifyVideoSource(
        "https://example.com/api/video-metadata",
        "application/json",
        "performance",
      ),
    ).toBeNull();
  });
});
