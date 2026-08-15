import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  type CommandRunner,
  mergeLocalSegments,
  runCommand,
  type TrackChunkWriter,
  validateLocalHlsPlaylist,
} from "../../src/local/segment-merger";

const cleanupPaths: string[] = [];

async function temporaryDirectory() {
  const path = await realpath(
    await mkdtemp(join(tmpdir(), "segment-merger-test-")),
  );
  cleanupPaths.push(path);
  return path;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("validateLocalHlsPlaylist", () => {
  test("accepts a finite local media playlist and verifies every referenced file", async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, "media"));
    await writeFile(join(root, "init.mp4"), "init");
    await writeFile(join(root, "media", "part-01.m4s"), "part");
    const playlist = join(root, "video.m3u8");
    await writeFile(
      playlist,
      [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        '#EXT-X-MAP:URI="init.mp4"',
        "#EXTINF:1.0,",
        "media/part-01.m4s",
        "#EXT-X-ENDLIST",
      ].join("\n"),
    );

    const result = await validateLocalHlsPlaylist(playlist);

    expect(result.playlistPath).toBe(playlist);
    expect(result.mediaPaths).toEqual([
      join(root, "init.mp4"),
      join(root, "media", "part-01.m4s"),
    ]);
    expect(result.sanitizedContent).toContain(
      `URI="${pathToFileURL(join(root, "init.mp4")).href}"`,
    );
    expect(result.sanitizedContent).toContain(
      pathToFileURL(join(root, "media", "part-01.m4s")).href,
    );
    expect(result.sanitizedContent.split("\n")).not.toContain(
      "media/part-01.m4s",
    );
  });

  test.each([
    {
      name: "remote segment",
      lines: [
        "#EXTM3U",
        "#EXTINF:1,",
        "https://example.com/part.ts",
        "#EXT-X-ENDLIST",
      ],
      code: "remote-input",
    },
    {
      name: "remote map",
      lines: [
        "#EXTM3U",
        '#EXT-X-MAP:URI="https://example.com/init.mp4"',
        "#EXTINF:1,",
        "part.ts",
        "#EXT-X-ENDLIST",
      ],
      code: "remote-input",
    },
    {
      name: "encrypted media",
      lines: [
        "#EXTM3U",
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
        "#EXTINF:1,",
        "part.ts",
        "#EXT-X-ENDLIST",
      ],
      code: "encrypted-input",
    },
    {
      name: "duplicate encryption methods",
      lines: [
        "#EXTM3U",
        '#EXT-X-KEY:METHOD=NONE,METHOD=AES-128,URI="key.bin"',
        "#EXTINF:1,",
        "part.ts",
        "#EXT-X-ENDLIST",
      ],
      code: "encrypted-input",
    },
    {
      name: "live media",
      lines: ["#EXTM3U", "#EXTINF:1,", "part.ts"],
      code: "live-input",
    },
    {
      name: "master playlist",
      lines: [
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=1000",
        "variant.m3u8",
        "#EXT-X-ENDLIST",
      ],
      code: "master-playlist",
    },
    {
      name: "parent traversal",
      lines: ["#EXTM3U", "#EXTINF:1,", "../part.ts", "#EXT-X-ENDLIST"],
      code: "path-escape",
    },
    {
      name: "percent-encoded remote segment",
      lines: [
        "#EXTM3U",
        "#EXTINF:1,",
        "https%3A%2F%2Fexample.com%2Fpart.ts",
        "#EXT-X-ENDLIST",
      ],
      code: "remote-input",
    },
    {
      name: "playlist variable substitution",
      lines: [
        "#EXTM3U",
        '#EXT-X-DEFINE:NAME="origin",VALUE="https://example.com"',
        "#EXTINF:1,",
        "{$origin}/part.ts",
        "#EXT-X-ENDLIST",
      ],
      code: "invalid-input",
    },
  ])("rejects $name before invoking FFmpeg", async ({ lines, code }) => {
    const root = await temporaryDirectory();
    await writeFile(join(root, "part.ts"), "part");
    const playlist = join(root, "video.m3u8");
    await writeFile(playlist, lines.join("\n"));

    await expect(validateLocalHlsPlaylist(playlist)).rejects.toMatchObject({
      code,
    });
  });

  test("rejects a nested playlist disguised as a media segment", async () => {
    const root = await temporaryDirectory();
    await writeFile(
      join(root, "nested.m3u8"),
      "#EXTM3U\nhttps://example.com/part.ts",
    );
    const playlist = join(root, "video.m3u8");
    await writeFile(
      playlist,
      ["#EXTM3U", "#EXTINF:1,", "nested.m3u8", "#EXT-X-ENDLIST"].join("\n"),
    );

    await expect(validateLocalHlsPlaylist(playlist)).rejects.toMatchObject({
      code: "invalid-input",
    });
  });

  test("rejects a symlink that escapes the playlist directory", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await writeFile(join(outside, "part.ts"), "part");
    await symlink(join(outside, "part.ts"), join(root, "part.ts"));
    const playlist = join(root, "video.m3u8");
    await writeFile(
      playlist,
      ["#EXTM3U", "#EXTINF:1,", "part.ts", "#EXT-X-ENDLIST"].join("\n"),
    );

    await expect(validateLocalHlsPlaylist(playlist)).rejects.toMatchObject({
      code: "path-escape",
    });
  });

  test("rejects a missing segment before invoking FFmpeg", async () => {
    const root = await temporaryDirectory();
    const playlist = join(root, "video.m3u8");
    await writeFile(
      playlist,
      ["#EXTM3U", "#EXTINF:1,", "missing.ts", "#EXT-X-ENDLIST"].join("\n"),
    );

    await expect(validateLocalHlsPlaylist(playlist)).rejects.toMatchObject({
      code: "missing-input",
    });
  });
});

describe("mergeLocalSegments", () => {
  function successfulRunner(
    calls: Array<{ arguments_: string[]; command: string }>,
  ): CommandRunner {
    return async (command, arguments_) => {
      calls.push({ arguments_, command });
      if (command === "ffmpeg") {
        await writeFile(arguments_.at(-1) as string, "merged");
        return { stderr: "", stdout: "" };
      }
      return {
        stderr: "",
        stdout: JSON.stringify({
          format: { duration: "1.0", format_name: "mov,mp4" },
          streams: [{ codec_name: "h264", codec_type: "video", index: 0 }],
        }),
      };
    };
  }

  test("remuxes a validated local HLS playlist and atomically publishes the output", async () => {
    const root = await temporaryDirectory();
    const segment = join(root, "part.ts");
    const playlist = join(root, "video.m3u8");
    const output = join(root, "result.mp4");
    await writeFile(segment, "part");
    await writeFile(
      playlist,
      ["#EXTM3U", "#EXTINF:1,", "part.ts", "#EXT-X-ENDLIST"].join("\n"),
    );
    const calls: Array<{ arguments_: string[]; command: string }> = [];

    const result = await mergeLocalSegments(
      { output, overwrite: false, playlist, segments: [] },
      { runCommand: successfulRunner(calls) },
    );

    expect(result).toEqual({ outputPath: output, streamTypes: ["video"] });
    expect(await readFile(output, "utf8")).toBe("merged");
    expect(calls[0]).toEqual(
      expect.objectContaining({
        command: "ffmpeg",
        arguments_: expect.arrayContaining([
          "-nostdin",
          "-protocol_whitelist",
          "file",
          "-c",
          "copy",
        ]),
      }),
    );
    expect(calls[0]?.arguments_).not.toContain(playlist);
    expect(calls[0]?.arguments_[calls[0].arguments_.indexOf("-i") + 1]).toMatch(
      /\.playlist-[\w-]+\.m3u8$/,
    );
    expect(calls[1]?.command).toBe("ffprobe");
    expect((await readdir(root)).some((name) => name.includes(".merge-"))).toBe(
      false,
    );
  });

  test("maps paired local HLS video and audio playlists explicitly", async () => {
    const root = await temporaryDirectory();
    const videoPlaylist = join(root, "video.m3u8");
    const audioPlaylist = join(root, "audio.m3u8");
    const output = join(root, "result.mp4");
    await writeFile(join(root, "video.m4s"), "video");
    await writeFile(join(root, "audio.m4s"), "audio");
    await writeFile(
      videoPlaylist,
      ["#EXTM3U", "#EXTINF:1,", "video.m4s", "#EXT-X-ENDLIST"].join("\n"),
    );
    await writeFile(
      audioPlaylist,
      ["#EXTM3U", "#EXTINF:1,", "audio.m4s", "#EXT-X-ENDLIST"].join("\n"),
    );
    const calls: Array<{ arguments_: string[]; command: string }> = [];
    const runner: CommandRunner = async (command, arguments_) => {
      calls.push({ arguments_, command });
      if (command === "ffmpeg") {
        await writeFile(arguments_.at(-1) as string, "merged");
        return { stderr: "", stdout: "" };
      }
      return {
        stderr: "",
        stdout: JSON.stringify({
          format: { duration: "1.0" },
          streams: [
            { codec_name: "h264", codec_type: "video", start_time: "0" },
            { codec_name: "aac", codec_type: "audio", start_time: "0" },
          ],
        }),
      };
    };

    const result = await mergeLocalSegments(
      {
        audioPlaylist,
        output,
        overwrite: false,
        segments: [],
        videoPlaylist,
      },
      { runCommand: runner },
    );

    expect(result.streamTypes).toEqual(["video", "audio"]);
    expect(calls[0]?.arguments_).toEqual(
      expect.arrayContaining([
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-protocol_whitelist",
        "file",
      ]),
    );
    expect(calls[0]?.arguments_.filter((item) => item === "-i")).toHaveLength(
      2,
    );
    expect(
      (await readdir(root)).some((name) => name.includes(".playlist-")),
    ).toBe(false);
  });

  test("assembles ordered fragmented tracks before remuxing", async () => {
    const root = await temporaryDirectory();
    const output = join(root, "result.mp4");
    for (const [name, content] of [
      ["video-init.m4s", "video-init|"],
      ["video-1.m4s", "video-one|"],
      ["video-2.m4s", "video-two|"],
      ["audio-init.m4s", "audio-init|"],
      ["audio-1.m4s", "audio-one|"],
    ]) {
      await writeFile(join(root, name), content);
    }
    const tracks = join(root, "tracks.json");
    await writeFile(
      tracks,
      JSON.stringify({
        version: 1,
        video: {
          init: "video-init.m4s",
          segments: ["video-1.m4s", "video-2.m4s"],
        },
        audio: {
          init: "audio-init.m4s",
          segments: ["audio-1.m4s"],
        },
      }),
    );
    let assembledVideo = "";
    let assembledAudio = "";
    let inputModes: number[] = [];
    const runner: CommandRunner = async (command, arguments_) => {
      if (command === "ffmpeg") {
        const inputs = arguments_
          .map((argument, index) =>
            argument === "-i" ? arguments_[index + 1] : undefined,
          )
          .filter((value): value is string => Boolean(value));
        assembledVideo = await readFile(inputs[0] as string, "utf8");
        assembledAudio = await readFile(inputs[1] as string, "utf8");
        inputModes = await Promise.all(
          inputs.map(async (path) => (await stat(path)).mode & 0o777),
        );
        await writeFile(arguments_.at(-1) as string, "merged");
        return { stderr: "", stdout: "" };
      }
      return {
        stderr: "",
        stdout: JSON.stringify({
          format: { duration: "2.0" },
          streams: [
            {
              codec_name: "h264",
              codec_type: "video",
              duration: "2",
              start_time: "0",
            },
            {
              codec_name: "aac",
              codec_type: "audio",
              duration: "2.02",
              start_time: "0",
            },
          ],
        }),
      };
    };

    await mergeLocalSegments(
      { output, overwrite: false, segments: [], tracks },
      { runCommand: runner },
    );

    expect(assembledVideo).toBe("video-init|video-one|video-two|");
    expect(assembledAudio).toBe("audio-init|audio-one|");
    expect(inputModes).toEqual([0o600, 0o600]);
    expect((await readdir(root)).some((name) => name.includes(".track-"))).toBe(
      false,
    );
  });

  test("routes a bounded DASH manifest through track assembly", async () => {
    const root = await temporaryDirectory();
    const output = join(root, "result.mp4");
    for (const name of ["v-init.m4s", "v-1.m4s", "a-init.m4s", "a-1.m4s"]) {
      await writeFile(join(root, name), name);
    }
    const dash = join(root, "presentation.mpd");
    await writeFile(
      dash,
      `<MPD type="static"><Period><AdaptationSet contentType="video"><Representation id="v" mimeType="video/mp4"><SegmentList><Initialization sourceURL="v-init.m4s"/><SegmentURL media="v-1.m4s"/></SegmentList></Representation></AdaptationSet><AdaptationSet contentType="audio"><Representation id="a" mimeType="audio/mp4"><SegmentList><Initialization sourceURL="a-init.m4s"/><SegmentURL media="a-1.m4s"/></SegmentList></Representation></AdaptationSet></Period></MPD>`,
    );
    const calls: Array<{ arguments_: string[]; command: string }> = [];
    const runner: CommandRunner = async (command, arguments_) => {
      calls.push({ arguments_, command });
      if (command === "ffmpeg") {
        await writeFile(arguments_.at(-1) as string, "merged");
        return { stderr: "", stdout: "" };
      }
      return {
        stderr: "",
        stdout: JSON.stringify({
          format: { duration: "1" },
          streams: [
            { codec_name: "h264", codec_type: "video", start_time: "0" },
            { codec_name: "aac", codec_type: "audio", start_time: "0" },
          ],
        }),
      };
    };

    const result = await mergeLocalSegments(
      { dash, output, overwrite: false, segments: [] },
      { runCommand: runner },
    );

    expect(result.outputPath).toBe(output);
    expect(calls[0]?.arguments_.filter((item) => item === "-i")).toHaveLength(
      2,
    );
  });

  test("preserves explicit segment order in a temporary concat manifest", async () => {
    const root = await temporaryDirectory();
    const first = join(root, "part '01'.ts");
    const second = join(root, "part-02.ts");
    const output = join(root, "result.mkv");
    await writeFile(first, "first");
    await writeFile(second, "second");
    let concatManifest = "";
    const calls: Array<{ arguments_: string[]; command: string }> = [];
    const runner: CommandRunner = async (command, arguments_) => {
      calls.push({ arguments_, command });
      if (command === "ffmpeg") {
        const concatPath = arguments_[arguments_.indexOf("-i") + 1];
        concatManifest = await readFile(concatPath, "utf8");
        await writeFile(arguments_.at(-1) as string, "merged");
        return { stderr: "", stdout: "" };
      }
      return {
        stderr: "",
        stdout: JSON.stringify({ streams: [{ codec_type: "audio" }] }),
      };
    };

    const result = await mergeLocalSegments(
      { output, overwrite: false, segments: [first, second] },
      { runCommand: runner },
    );

    expect(result.streamTypes).toEqual(["audio"]);
    expect(concatManifest).toContain("ffconcat version 1.0");
    expect(concatManifest.indexOf("part")).toBeLessThan(
      concatManifest.indexOf("part-02.ts"),
    );
    expect(calls[0]?.arguments_).toEqual(
      expect.arrayContaining(["-f", "concat", "-safe", "0"]),
    );
  });

  test("rejects control characters that could inject concat directives", async () => {
    const root = await temporaryDirectory();
    const injectedName = "part.ts'\nfile 'secret.ts";
    const segment = join(root, injectedName);
    await writeFile(segment, "part");
    const runCommand = vi.fn<CommandRunner>();

    await expect(
      mergeLocalSegments(
        {
          output: join(root, "result.mp4"),
          overwrite: false,
          segments: [segment],
        },
        { runCommand },
      ),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(runCommand).not.toHaveBeenCalled();
  });

  test("rejects a playlist supplied as an explicit media segment", async () => {
    const root = await temporaryDirectory();
    const nested = join(root, "nested.m3u8");
    await writeFile(nested, "#EXTM3U\nhttps://example.com/part.ts");
    const runCommand = vi.fn<CommandRunner>();

    await expect(
      mergeLocalSegments(
        {
          output: join(root, "result.mp4"),
          overwrite: false,
          segments: [nested],
        },
        { runCommand },
      ),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(runCommand).not.toHaveBeenCalled();
  });

  test("rejects remote explicit inputs before invoking FFmpeg", async () => {
    const root = await temporaryDirectory();
    const runCommand = vi.fn<CommandRunner>();

    await expect(
      mergeLocalSegments(
        {
          output: join(root, "result.mp4"),
          overwrite: false,
          segments: ["https://example.com/part.ts"],
        },
        { runCommand },
      ),
    ).rejects.toMatchObject({ code: "remote-input" });
    expect(runCommand).not.toHaveBeenCalled();
  });

  test("rejects non-file overwrite targets", async () => {
    const root = await temporaryDirectory();
    const segment = join(root, "part.ts");
    const output = join(root, "result.mp4");
    await writeFile(segment, "part");
    await mkdir(output);
    const runCommand = vi.fn<CommandRunner>();

    await expect(
      mergeLocalSegments(
        { output, overwrite: true, segments: [segment] },
        { runCommand },
      ),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(runCommand).not.toHaveBeenCalled();
  });

  test("preserves an existing output unless overwrite is explicit", async () => {
    const root = await temporaryDirectory();
    const segment = join(root, "part.ts");
    const output = join(root, "result.mp4");
    await writeFile(segment, "part");
    await writeFile(output, "keep");
    const runCommand = vi.fn<CommandRunner>();

    await expect(
      mergeLocalSegments(
        { output, overwrite: false, segments: [segment] },
        { runCommand },
      ),
    ).rejects.toMatchObject({ code: "output-exists" });
    expect(await readFile(output, "utf8")).toBe("keep");
    expect(runCommand).not.toHaveBeenCalled();
  });

  test("cleans temporary files and preserves an overwritten target when FFmpeg fails", async () => {
    const root = await temporaryDirectory();
    const segment = join(root, "part.ts");
    const output = join(root, "result.mp4");
    await writeFile(segment, "part");
    await writeFile(output, "keep");
    const runCommand: CommandRunner = async (_command, arguments_) => {
      await writeFile(arguments_.at(-1) as string, "partial");
      throw new Error("ffmpeg failed");
    };

    await expect(
      mergeLocalSegments(
        { output, overwrite: true, segments: [segment] },
        { runCommand },
      ),
    ).rejects.toMatchObject({ code: "merge-failed" });
    expect(await readFile(output, "utf8")).toBe("keep");
    expect((await readdir(root)).some((name) => name.includes(".merge-"))).toBe(
      false,
    );
  });

  test("does not replace an output created while a no-overwrite merge is running", async () => {
    const root = await temporaryDirectory();
    const segment = join(root, "part.ts");
    const output = join(root, "result.mp4");
    await writeFile(segment, "part");
    const runCommand: CommandRunner = async (command, arguments_) => {
      if (command === "ffmpeg") {
        await writeFile(arguments_.at(-1) as string, "merged");
        return { stderr: "", stdout: "" };
      }
      await writeFile(output, "raced");
      return {
        stderr: "",
        stdout: JSON.stringify({ streams: [{ codec_type: "video" }] }),
      };
    };

    await expect(
      mergeLocalSegments(
        { output, overwrite: false, segments: [segment] },
        { runCommand },
      ),
    ).rejects.toMatchObject({ code: "output-exists" });
    expect(await readFile(output, "utf8")).toBe("raced");
    expect((await readdir(root)).some((name) => name.includes(".merge-"))).toBe(
      false,
    );
  });

  test("honors cancellation after verification and before publishing", async () => {
    const root = await temporaryDirectory();
    const segment = join(root, "part.ts");
    const output = join(root, "result.mp4");
    await writeFile(segment, "part");
    const controller = new AbortController();
    const runCommand: CommandRunner = async (command, arguments_) => {
      if (command === "ffmpeg") {
        await writeFile(arguments_.at(-1) as string, "merged");
        return { stderr: "", stdout: "" };
      }
      controller.abort();
      return {
        stderr: "",
        stdout: JSON.stringify({ streams: [{ codec_type: "video" }] }),
      };
    };

    await expect(
      mergeLocalSegments(
        { output, overwrite: false, segments: [segment] },
        { runCommand, signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      code: "merge-failed",
      message: "The merge was cancelled.",
    });
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("bounds and sanitizes command diagnostics", async () => {
    let failure: unknown;
    try {
      await runCommand(process.execPath, [
        "-e",
        "process.stderr.write('x'.repeat(20_000) + '\\n'); process.exit(3)",
      ]);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: "merge-failed" });
    expect((failure as Error).message.length).toBeLessThan(8_400);
    expect((failure as Error).message).not.toContain("\n");
  });

  test("cancels a running local process without using a shell", async () => {
    const controller = new AbortController();
    const execution = runCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 10_000)"],
      controller.signal,
    );
    setTimeout(() => controller.abort(), 20);

    await expect(execution).rejects.toMatchObject({
      code: "merge-failed",
      message: "The merge was cancelled.",
    });
  });

  test("cancels track assembly without starting FFmpeg or leaving temporary files", async () => {
    const root = await temporaryDirectory();
    const large = Buffer.alloc(8 * 1_024 * 1_024, 1);
    await writeFile(join(root, "init.m4s"), large);
    await writeFile(join(root, "part.m4s"), large);
    const tracks = join(root, "tracks.json");
    await writeFile(
      tracks,
      JSON.stringify({
        version: 1,
        video: { init: "init.m4s", segments: ["part.m4s"] },
      }),
    );
    const controller = new AbortController();
    const runCommand = vi.fn<CommandRunner>();
    const merge = mergeLocalSegments(
      {
        output: join(root, "result.mp4"),
        overwrite: false,
        segments: [],
        tracks,
      },
      { runCommand, signal: controller.signal },
    );
    setImmediate(() => controller.abort());

    await expect(merge).rejects.toMatchObject({
      code: "merge-failed",
      message: "The merge was cancelled.",
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect((await readdir(root)).some((name) => name.includes(".track-"))).toBe(
      false,
    );
  });

  test("removes a partial assembled track after a disk-write failure", async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, "init.m4s"), "initialization");
    await writeFile(join(root, "part.m4s"), "fragment");
    const tracks = join(root, "tracks.json");
    await writeFile(
      tracks,
      JSON.stringify({
        version: 1,
        video: { init: "init.m4s", segments: ["part.m4s"] },
      }),
    );
    let writeCount = 0;
    const writeTrackChunk: TrackChunkWriter = async (
      target,
      buffer,
      offset,
      length,
    ) => {
      writeCount += 1;
      if (writeCount === 1) {
        return (await target.write(buffer, offset, Math.min(length, 1)))
          .bytesWritten;
      }
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    };
    const runCommand = vi.fn<CommandRunner>();

    await expect(
      mergeLocalSegments(
        {
          output: join(root, "result.mp4"),
          overwrite: false,
          segments: [],
          tracks,
        },
        { runCommand, writeTrackChunk },
      ),
    ).rejects.toMatchObject({ code: "merge-failed" });
    expect(runCommand).not.toHaveBeenCalled();
    expect((await readdir(root)).some((name) => name.includes(".track-"))).toBe(
      false,
    );
  });

  test.each([
    { name: "malformed probe JSON", stdout: "not json" },
    {
      name: "missing expected audio",
      stdout: JSON.stringify({
        format: { duration: "1" },
        streams: [{ codec_name: "h264", codec_type: "video", start_time: "0" }],
      }),
    },
    {
      name: "non-finite output duration",
      stdout: JSON.stringify({
        format: { duration: "N/A" },
        streams: [
          { codec_name: "h264", codec_type: "video", start_time: "0" },
          { codec_name: "aac", codec_type: "audio", start_time: "0" },
        ],
      }),
    },
  ])("rejects $name before publication", async ({ stdout }) => {
    const root = await temporaryDirectory();
    const videoPlaylist = join(root, "video.m3u8");
    const audioPlaylist = join(root, "audio.m3u8");
    await writeFile(join(root, "video.m4s"), "video");
    await writeFile(join(root, "audio.m4s"), "audio");
    await writeFile(
      videoPlaylist,
      "#EXTM3U\n#EXTINF:1,\nvideo.m4s\n#EXT-X-ENDLIST",
    );
    await writeFile(
      audioPlaylist,
      "#EXTM3U\n#EXTINF:1,\naudio.m4s\n#EXT-X-ENDLIST",
    );
    const output = join(root, "result.mp4");
    const runCommand: CommandRunner = async (command, arguments_) => {
      if (command === "ffmpeg") {
        await writeFile(arguments_.at(-1) as string, "merged");
        return { stderr: "", stdout: "" };
      }
      return { stderr: "", stdout };
    };

    await expect(
      mergeLocalSegments(
        {
          audioPlaylist,
          output,
          overwrite: false,
          segments: [],
          videoPlaylist,
        },
        { runCommand },
      ),
    ).rejects.toMatchObject({ code: "verification-failed" });
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(root)).some((name) => name.includes(".merge-"))).toBe(
      false,
    );
  });

  test("rejects an output with excessive audio-video timing skew", async () => {
    const root = await temporaryDirectory();
    const video = join(root, "video.m4s");
    const audio = join(root, "audio.m4s");
    const videoPlaylist = join(root, "video.m3u8");
    const audioPlaylist = join(root, "audio.m3u8");
    await writeFile(video, "video");
    await writeFile(audio, "audio");
    await writeFile(
      videoPlaylist,
      "#EXTM3U\n#EXTINF:1,\nvideo.m4s\n#EXT-X-ENDLIST",
    );
    await writeFile(
      audioPlaylist,
      "#EXTM3U\n#EXTINF:1,\naudio.m4s\n#EXT-X-ENDLIST",
    );
    const output = join(root, "result.mp4");
    const runCommand: CommandRunner = async (command, arguments_) => {
      if (command === "ffmpeg") {
        await writeFile(arguments_.at(-1) as string, "merged");
        return { stderr: "", stdout: "" };
      }
      return {
        stderr: "",
        stdout: JSON.stringify({
          format: { duration: "2" },
          streams: [
            {
              codec_name: "h264",
              codec_type: "video",
              duration: "1",
              start_time: "0",
            },
            {
              codec_name: "aac",
              codec_type: "audio",
              duration: "2",
              start_time: "0.5",
            },
          ],
        }),
      };
    };

    await expect(
      mergeLocalSegments(
        {
          audioPlaylist,
          output,
          overwrite: false,
          segments: [],
          videoPlaylist,
        },
        { runCommand },
      ),
    ).rejects.toMatchObject({ code: "verification-failed" });
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects an output with no verified audio or video streams", async () => {
    const root = await temporaryDirectory();
    const segment = join(root, "part.ts");
    const output = join(root, "result.mp4");
    await writeFile(segment, "part");
    const runCommand: CommandRunner = async (command, arguments_) => {
      if (command === "ffmpeg") {
        await writeFile(arguments_.at(-1) as string, "merged");
        return { stderr: "", stdout: "" };
      }
      return { stderr: "", stdout: JSON.stringify({ streams: [] }) };
    };

    await expect(
      mergeLocalSegments(
        { output, overwrite: false, segments: [segment] },
        { runCommand },
      ),
    ).rejects.toMatchObject({ code: "verification-failed" });
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
