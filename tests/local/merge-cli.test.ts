import { describe, expect, test, vi } from "vitest";
import {
  MERGE_USAGE,
  parseMergeArguments,
  runMergeCli,
} from "../../src/local/merge-cli";
import { SegmentMergeError } from "../../src/local/segment-merger";

describe("parseMergeArguments", () => {
  test("parses a local HLS playlist request", () => {
    expect(
      parseMergeArguments([
        "--playlist",
        "fixtures/video.m3u8",
        "--output",
        "result.mp4",
        "--overwrite",
      ]),
    ).toEqual({
      help: false,
      overwrite: true,
      output: "result.mp4",
      playlist: "fixtures/video.m3u8",
      segments: [],
    });
  });

  test("preserves the explicit order of repeated segment arguments", () => {
    expect(
      parseMergeArguments([
        "--segment",
        "part-02.ts",
        "--segment",
        "part-01.ts",
        "--output",
        "result.mp4",
      ]).segments,
    ).toEqual(["part-02.ts", "part-01.ts"]);
  });

  test("parses paired HLS playlists", () => {
    expect(
      parseMergeArguments([
        "--video-playlist",
        "video.m3u8",
        "--audio-playlist",
        "audio.m3u8",
        "--output",
        "result.mp4",
      ]),
    ).toEqual({
      audioPlaylist: "audio.m3u8",
      help: false,
      overwrite: false,
      output: "result.mp4",
      segments: [],
      videoPlaylist: "video.m3u8",
    });
  });

  test("parses a DASH request with explicit representations", () => {
    expect(
      parseMergeArguments([
        "--dash",
        "presentation.mpd",
        "--video-representation",
        "video-main",
        "--audio-representation",
        "audio-main",
        "--output",
        "result.mkv",
      ]),
    ).toEqual({
      audioRepresentation: "audio-main",
      dash: "presentation.mpd",
      help: false,
      overwrite: false,
      output: "result.mkv",
      segments: [],
      videoRepresentation: "video-main",
    });
  });

  test("parses a local track manifest", () => {
    expect(
      parseMergeArguments([
        "--tracks",
        "tracks.json",
        "--output",
        "result.webm",
      ]),
    ).toEqual({
      help: false,
      overwrite: false,
      output: "result.webm",
      segments: [],
      tracks: "tracks.json",
    });
  });

  test.each([
    { args: ["--output", "result.mp4"], message: "Provide a playlist" },
    {
      args: [
        "--playlist",
        "video.m3u8",
        "--segment",
        "part.ts",
        "--output",
        "result.mp4",
      ],
      message: "Choose either",
    },
    {
      args: [
        "--playlist",
        "https://example.com/video.m3u8",
        "--output",
        "result.mp4",
      ],
      message: "local filesystem paths",
    },
    {
      args: ["--segment", "part\u009b[31m.ts", "--output", "result.mp4"],
      message: "local filesystem paths",
    },
    {
      args: ["--video-playlist", "video.m3u8", "--output", "result.mp4"],
      message: "both --video-playlist and --audio-playlist",
    },
    {
      args: [
        "--tracks",
        "tracks.json",
        "--dash",
        "presentation.mpd",
        "--output",
        "result.mkv",
      ],
      message: "Choose either one input mode",
    },
    {
      args: [
        "--video-representation",
        "video-main",
        "--segment",
        "part.m4s",
        "--output",
        "result.mp4",
      ],
      message: "Representation selectors require --dash",
    },
    {
      args: [
        "--tracks",
        "tracks.json",
        "--tracks",
        "other.json",
        "--output",
        "result.mkv",
      ],
      message: "--tracks may be provided once",
    },
    {
      args: ["--playlist", "video.m3u8", "--output", "result.mp4", "--wat"],
      message: "Unknown argument",
    },
  ])("rejects invalid invocation: $message", ({ args, message }) => {
    expect(() => parseMergeArguments(args)).toThrowError(message);
  });
});

describe("runMergeCli", () => {
  test("prints help without starting a merge", async () => {
    const log = vi.fn();
    const error = vi.fn();
    const merge = vi.fn();

    await expect(
      runMergeCli(["--help"], { error, log }, { merge }),
    ).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith(MERGE_USAGE);
    expect(error).not.toHaveBeenCalled();
    expect(merge).not.toHaveBeenCalled();
  });

  test("reports a successful local merge", async () => {
    const log = vi.fn();
    const error = vi.fn();
    const merge = vi.fn().mockResolvedValue({
      outputPath: "/tmp/result.mp4",
      streamTypes: ["video", "audio"],
    });

    await expect(
      runMergeCli(
        ["--playlist", "video.m3u8", "--output", "result.mp4"],
        { error, log },
        { merge },
      ),
    ).resolves.toBe(0);

    expect(merge).toHaveBeenCalledWith(
      {
        output: "result.mp4",
        overwrite: false,
        playlist: "video.m3u8",
        segments: [],
      },
      { signal: undefined },
    );
    expect(log).toHaveBeenCalledWith(
      "Merged video + audio into /tmp/result.mp4",
    );
    expect(error).not.toHaveBeenCalled();
  });

  test("forwards a paired HLS request", async () => {
    const merge = vi.fn().mockResolvedValue({
      outputPath: "/tmp/result.mp4",
      streamTypes: ["video", "audio"],
    });

    await expect(
      runMergeCli(
        [
          "--video-playlist",
          "video.m3u8",
          "--audio-playlist",
          "audio.m3u8",
          "--output",
          "result.mp4",
        ],
        { error: vi.fn(), log: vi.fn() },
        { merge },
      ),
    ).resolves.toBe(0);

    expect(merge).toHaveBeenCalledWith(
      {
        audioPlaylist: "audio.m3u8",
        output: "result.mp4",
        overwrite: false,
        segments: [],
        videoPlaylist: "video.m3u8",
      },
      { signal: undefined },
    );
  });

  test("uses distinct exit codes for usage and merge failures", async () => {
    const usageError = vi.fn();
    await expect(
      runMergeCli([], { error: usageError, log: vi.fn() }),
    ).resolves.toBe(2);
    expect(usageError).toHaveBeenCalledWith(
      expect.stringContaining(MERGE_USAGE),
    );

    const mergeError = vi.fn();
    const merge = vi
      .fn()
      .mockRejectedValue(
        new SegmentMergeError("encrypted-input", "Encrypted input."),
      );
    await expect(
      runMergeCli(
        ["--playlist", "video.m3u8", "--output", "result.mp4"],
        { error: mergeError, log: vi.fn() },
        { merge },
      ),
    ).resolves.toBe(1);
    expect(mergeError).toHaveBeenCalledWith(
      "encrypted-input: Encrypted input.",
    );
  });
});
