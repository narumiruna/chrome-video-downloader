import { describe, expect, test, vi } from "vitest";
import type { VideoCandidate } from "../../src/core/video-candidate";
import {
  type ChromeDownloadsApi,
  startBlobDownload,
  startVideoDownload,
} from "../../src/platform/chrome-downloads";

const candidate: VideoCandidate = {
  id: "candidate-1",
  displayName: "video.mp4",
  format: "MP4",
  hostname: "cdn.example.com",
  sourceType: "direct",
  support: { status: "downloadable" },
  url: "https://cdn.example.com/video.mp4?token=secret",
};

function downloadsApi(result: number | Error = 42): ChromeDownloadsApi {
  return {
    download:
      result instanceof Error
        ? vi.fn().mockRejectedValue(result)
        : vi.fn().mockResolvedValue(result),
  };
}

describe("startVideoDownload", () => {
  test("hands an assembled MP4 Blob to Chrome with a safe filename", async () => {
    const api = downloadsApi();
    const createDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      "createObjectURL",
    );
    const revokeDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      "revokeObjectURL",
    );
    const createObjectURL = vi.fn(() => "blob:assembled-video");
    const revokeObjectURL = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    vi.useFakeTimers();

    try {
      const result = await startBlobDownload(
        new Blob(["video"], { type: "video/mp4" }),
        "lesson.mp4",
        api,
      );

      expect(api.download).toHaveBeenCalledWith({
        filename: "lesson.mp4",
        url: "blob:assembled-video",
      });
      expect(result).toEqual({ downloadId: 42, status: "accepted" });
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:assembled-video");
    } finally {
      vi.useRealTimers();
      if (createDescriptor) {
        Object.defineProperty(URL, "createObjectURL", createDescriptor);
      } else {
        Reflect.deleteProperty(URL, "createObjectURL");
      }
      if (revokeDescriptor) {
        Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
      } else {
        Reflect.deleteProperty(URL, "revokeObjectURL");
      }
    }
  });

  test("rejects unsafe assembled MP4 filenames before the Chrome API", async () => {
    const api = downloadsApi();

    for (const filename of [
      "../lesson.mp4",
      "lesson\u009b[31m.mp4",
      "evil\u202egpj.mp4",
    ]) {
      await expect(
        startBlobDownload(
          new Blob(["video"], { type: "video/mp4" }),
          filename,
          api,
        ),
      ).resolves.toEqual({ code: "invalid-candidate", status: "error" });
    }
    expect(api.download).not.toHaveBeenCalled();
  });

  test("hands a validated URL to Chrome without overriding browser choices", async () => {
    const api = downloadsApi();

    const result = await startVideoDownload(candidate, api);

    expect(api.download).toHaveBeenCalledWith({ url: candidate.url });
    expect(result).toEqual({ downloadId: 42, status: "accepted" });
  });

  test("rejects unsupported and mutated unsafe candidates before the Chrome API", async () => {
    const api = downloadsApi();
    const unsupported: VideoCandidate = {
      ...candidate,
      sourceType: "hls",
      support: { reason: "hls", status: "unsupported" },
    };
    const mutated = { ...candidate, url: "javascript:alert(1)" };

    await expect(startVideoDownload(unsupported, api)).resolves.toEqual({
      code: "invalid-candidate",
      status: "error",
    });
    await expect(startVideoDownload(mutated, api)).resolves.toEqual({
      code: "invalid-candidate",
      status: "error",
    });
    expect(api.download).not.toHaveBeenCalled();
  });

  test("returns a stable error without exposing Chrome's error text", async () => {
    const api = downloadsApi(new Error("failed for ?token=secret"));

    const result = await startVideoDownload(candidate, api);

    expect(result).toEqual({ code: "download-failed", status: "error" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("treats a non-integer download id as a failure", async () => {
    const api = downloadsApi(0.5);

    await expect(startVideoDownload(candidate, api)).resolves.toEqual({
      code: "download-failed",
      status: "error",
    });
  });
});
