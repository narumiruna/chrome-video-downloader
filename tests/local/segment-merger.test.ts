import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
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
  validateLocalHlsPlaylist,
} from "../../src/local/segment-merger";

const cleanupPaths: string[] = [];

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "segment-merger-test-"));
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
