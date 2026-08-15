import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { assembleCapturedMp4 } from "../../src/core/assemble-captured-mp4";
import type { VideoCandidate } from "../../src/core/video-candidate";
import type { DownloadResult } from "../../src/platform/chrome-downloads";
import type { ScanPageResult } from "../../src/platform/chrome-tabs";
import { App } from "../../src/popup/App";

const direct: VideoCandidate = {
  id: "direct",
  displayName: "lesson.mp4",
  duration: 65,
  format: "MP4",
  height: 720,
  hostname: "cdn.example.com",
  sourceType: "direct",
  support: { status: "downloadable" },
  url: "https://cdn.example.com/lesson.mp4?token=top-secret",
  width: 1280,
};
const second: VideoCandidate = {
  ...direct,
  id: "second",
  displayName: "backup.webm",
  format: "WEBM",
  url: "https://cdn.example.com/backup.webm",
};
const hls: VideoCandidate = {
  ...direct,
  id: "hls",
  displayName: "HLS stream",
  format: "HLS",
  sourceType: "hls",
  support: { reason: "hls", status: "unsupported" },
  url: "https://cdn.example.com/master.m3u8?token=secret",
};

function success(
  candidates: VideoCandidate[],
  capturedVideos: Extract<
    ScanPageResult,
    { status: "success" }
  >["capturedVideos"] = [],
): ScanPageResult {
  return {
    candidates,
    capturedVideos,
    iframeUrls: [],
    pageTitle: "Training lesson",
    pageUrl: "https://example.com/watch?private=value",
    status: "success",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("App", () => {
  test("shows a stable scanning state, then direct candidates without secret URLs", async () => {
    const scan = deferred<ScanPageResult>();
    render(
      <App locale="en" scanPage={() => scan.promise} downloadVideo={vi.fn()} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Scanning this page");
    scan.resolve(success([direct, hls]));

    expect(
      await screen.findByRole("heading", { name: "Training lesson" }),
    ).toBeVisible();
    const directCard = screen
      .getByRole("heading", { name: "lesson.mp4" })
      .closest("li");
    expect(directCard).not.toBeNull();
    expect(
      within(directCard as HTMLLIElement).getByText("1280×720"),
    ).toBeVisible();
    expect(within(directCard as HTMLLIElement).getByText("1:05")).toBeVisible();
    expect(screen.getByText("HLS stream")).toBeVisible();
    expect(
      screen.queryByText(/top-secret|private=value/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Page and video URLs are processed only on this device and are not sent to the developer.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Download lesson.mp4" }),
    ).toBeEnabled();
  });

  test("assembles captured audio and video parts into one MP4 download", async () => {
    const capturedVideos = [
      {
        mimeType: "video/mp4",
        timestamp: 1,
        url: "https://media.example/video-part.m4s?secret=video",
      },
      {
        mimeType: "audio/mp4",
        timestamp: 2,
        url: "https://media.example/audio-part.m4s?secret=audio",
      },
    ];
    const assembleVideo = vi.fn<typeof assembleCapturedMp4>(
      async (_requests, options) => {
        options?.onProgress?.({ phase: "muxing", completed: 0, total: 1 });
        return new Blob(["combined"], { type: "video/mp4" });
      },
    );
    const downloadAssembledVideo = vi
      .fn()
      .mockResolvedValue({ downloadId: 14, status: "accepted" });
    const user = userEvent.setup();

    render(
      <App
        locale="en"
        scanPage={vi.fn().mockResolvedValue(success([], capturedVideos))}
        downloadVideo={vi.fn()}
        assembleVideo={assembleVideo}
        downloadAssembledVideo={downloadAssembledVideo}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Captured video stream" }),
    ).toBeVisible();
    expect(screen.getByText("video/mp4 × 1")).toBeVisible();
    expect(screen.getByText("audio/mp4 × 1")).toBeVisible();
    expect(screen.queryByText(/secret=video|secret=audio/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Assemble MP4" }));

    expect(assembleVideo).toHaveBeenCalledWith(
      capturedVideos,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(downloadAssembledVideo).toHaveBeenCalledWith(
      expect.objectContaining({ type: "video/mp4" }),
      "Training lesson.mp4",
    );
    expect(await screen.findByText("Sent to Chrome downloads.")).toBeVisible();
  });

  test("prevents duplicate submission while leaving other candidates usable", async () => {
    const download = deferred<DownloadResult>();
    const downloadVideo = vi.fn().mockImplementation(() => download.promise);
    const user = userEvent.setup();
    render(
      <App
        locale="en"
        scanPage={vi.fn().mockResolvedValue(success([direct, second]))}
        downloadVideo={downloadVideo}
      />,
    );

    const firstButton = await screen.findByRole("button", {
      name: "Download lesson.mp4",
    });
    const secondButton = screen.getByRole("button", {
      name: "Download backup.webm",
    });
    await user.dblClick(firstButton);

    expect(downloadVideo).toHaveBeenCalledTimes(1);
    expect(firstButton).toBeDisabled();
    expect(secondButton).toBeEnabled();

    download.resolve({ downloadId: 12, status: "accepted" });
    expect(await screen.findByText("Sent to Chrome downloads.")).toBeVisible();
    expect(firstButton).toHaveTextContent("Sent to Chrome");
  });

  test("keeps a failed candidate available for retry", async () => {
    const downloadVideo = vi
      .fn()
      .mockResolvedValueOnce({ code: "download-failed", status: "error" })
      .mockResolvedValueOnce({ downloadId: 13, status: "accepted" });
    const user = userEvent.setup();
    render(
      <App
        locale="en"
        scanPage={vi.fn().mockResolvedValue(success([direct]))}
        downloadVideo={downloadVideo}
      />,
    );

    const button = await screen.findByRole("button", {
      name: "Download lesson.mp4",
    });
    await user.click(button);
    expect(
      await screen.findByText(
        "Chrome could not start this download. Try again.",
      ),
    ).toBeVisible();
    expect(button).toBeEnabled();

    await user.click(button);
    expect(downloadVideo).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Sent to Chrome downloads.")).toBeVisible();
  });

  test.each([
    [success([]), "No direct videos found", "Play the video, then scan again."],
    [
      success([hls]),
      "Streaming source found",
      "HLS streams are not supported.",
    ],
    [
      {
        pageTitle: "Extensions",
        status: "restricted",
      } satisfies ScanPageResult,
      "This page is restricted",
      "Chrome does not allow extensions to scan this page.",
    ],
    [
      { code: "scan-failed", status: "error" } satisfies ScanPageResult,
      "Scan failed",
      "Reload the page and try again.",
    ],
  ])(
    "renders a recoverable non-success state",
    async (result, heading, message) => {
      render(
        <App
          locale="en"
          scanPage={vi.fn().mockResolvedValue(result)}
          downloadVideo={vi.fn()}
        />,
      );

      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeVisible();
      expect(screen.getByText(message)).toBeVisible();
      if (result.status !== "restricted") {
        expect(
          screen.getByRole("button", { name: "Scan again" }),
        ).toBeEnabled();
      }
    },
  );

  test("provides Traditional Chinese copy", async () => {
    render(
      <App
        locale="zh-TW"
        scanPage={vi.fn().mockResolvedValue(success([]))}
        downloadVideo={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "找不到直接影片" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "重新掃描" })).toBeEnabled();
  });
});
