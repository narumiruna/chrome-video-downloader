import type { VideoCandidate } from "../core/video-candidate";

const MAX_URL_LENGTH = 8_192;

export interface ChromeDownloadsApi {
  download(options: { url: string; filename?: string }): Promise<number>;
}

export type DownloadResult =
  | { status: "accepted"; downloadId: number }
  | { status: "error"; code: "invalid-candidate" | "download-failed" };

function defaultChromeApi(): ChromeDownloadsApi {
  return {
    download: (options) => chrome.downloads.download(options),
  };
}

function isSafeDownloadCandidate(candidate: VideoCandidate): boolean {
  if (
    candidate.support.status !== "downloadable" ||
    candidate.sourceType !== "direct" ||
    typeof candidate.url !== "string" ||
    candidate.url.length === 0 ||
    candidate.url.length > MAX_URL_LENGTH
  ) {
    return false;
  }
  try {
    const url = new URL(candidate.url);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export async function startBlobDownload(
  blob: Blob,
  filename: string,
  api: ChromeDownloadsApi = defaultChromeApi(),
): Promise<DownloadResult> {
  if (blob.size === 0 || blob.type !== "video/mp4" || filename.length === 0) {
    return { code: "invalid-candidate", status: "error" };
  }

  const url = URL.createObjectURL(blob);
  try {
    const downloadId = await api.download({ filename, url });
    return Number.isInteger(downloadId) && downloadId >= 0
      ? { downloadId, status: "accepted" }
      : { code: "download-failed", status: "error" };
  } catch {
    return { code: "download-failed", status: "error" };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export async function startVideoDownload(
  candidate: VideoCandidate,
  api: ChromeDownloadsApi = defaultChromeApi(),
): Promise<DownloadResult> {
  if (!isSafeDownloadCandidate(candidate)) {
    return { code: "invalid-candidate", status: "error" };
  }
  try {
    const downloadId = await api.download({ url: candidate.url });
    return Number.isInteger(downloadId) && downloadId >= 0
      ? { downloadId, status: "accepted" }
      : { code: "download-failed", status: "error" };
  } catch {
    return { code: "download-failed", status: "error" };
  }
}
