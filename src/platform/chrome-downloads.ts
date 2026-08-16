import type { VideoCandidate } from "../core/video-candidate";

const MAX_URL_LENGTH = 8_192;
const MAX_FILENAME_LENGTH = 240;

export interface ChromeDownloadsApi {
  download(options: { url: string; filename?: string }): Promise<number>;
}

export type DownloadResult =
  | { status: "accepted"; downloadId: number }
  | { status: "error"; code: "invalid-candidate" | "download-failed" };

function isUnsafeFilenameCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x200e ||
    code === 0x200f ||
    '<>:"/\\|?*'.includes(character)
  );
}

function isSafeFilename(filename: string): boolean {
  const characters = Array.from(filename);
  if (
    characters.length === 0 ||
    characters.length > MAX_FILENAME_LENGTH ||
    !filename.toLowerCase().endsWith(".mp4")
  ) {
    return false;
  }
  const stem = filename.slice(0, -4).trim();
  return stem.length > 0 && !characters.some(isUnsafeFilenameCharacter);
}

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
  if (
    blob.size === 0 ||
    blob.type !== "video/mp4" ||
    !isSafeFilename(filename)
  ) {
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
