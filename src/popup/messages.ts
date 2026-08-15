export type SupportedLocale = "en" | "zh-TW";

export interface Messages {
  appName: string;
  rightsNotice: string;
  privacyNotice: string;
  scanning: string;
  scanAgain: string;
  emptyTitle: string;
  emptyMessage: string;
  unsupportedTitle: string;
  restrictedTitle: string;
  restrictedMessage: string;
  errorTitle: string;
  errorMessage: string;
  download: string;
  downloading: string;
  sentButton: string;
  retry: string;
  sentStatus: string;
  downloadError: string;
  unsupported: string;
  sourceHost: string;
  capturedStreamTitle: string;
  capturedStreamHint: string;
  assemble: string;
  fetchingParts: string;
  muxing: string;
  assemblyError: string;
}

const messages: Record<SupportedLocale, Messages> = {
  en: {
    appName: "Video Downloader",
    rightsNotice: "Download only videos you own or have permission to save.",
    privacyNotice:
      "Page and video URLs are processed only on this device and are not sent to the developer.",
    scanning: "Scanning this page…",
    scanAgain: "Scan again",
    emptyTitle: "No direct videos found",
    emptyMessage: "Play the video, then scan again.",
    unsupportedTitle: "Streaming source found",
    restrictedTitle: "This page is restricted",
    restrictedMessage: "Chrome does not allow extensions to scan this page.",
    errorTitle: "Scan failed",
    errorMessage: "Reload the page and try again.",
    download: "Download",
    downloading: "Starting…",
    sentButton: "Sent to Chrome",
    retry: "Try again",
    sentStatus: "Sent to Chrome downloads.",
    downloadError: "Chrome could not start this download. Try again.",
    unsupported: "Not supported",
    sourceHost: "Source",
    capturedStreamTitle: "Captured video stream",
    capturedStreamHint:
      "Play the video from beginning to end before assembling all captured parts.",
    assemble: "Assemble MP4",
    fetchingParts: "Downloading stream parts…",
    muxing: "Combining audio and video…",
    assemblyError:
      "The captured stream could not be assembled. Replay it from the beginning and try again.",
  },
  "zh-TW": {
    appName: "影片下載器",
    rightsNotice: "請只下載您擁有或獲授權保存的影片。",
    privacyNotice: "頁面與影片網址只會在此裝置上處理，不會傳送給開發者。",
    scanning: "正在掃描此頁面…",
    scanAgain: "重新掃描",
    emptyTitle: "找不到直接影片",
    emptyMessage: "請先播放影片，然後重新掃描。",
    unsupportedTitle: "找到串流來源",
    restrictedTitle: "此頁面受到限制",
    restrictedMessage: "Chrome 不允許擴充功能掃描此頁面。",
    errorTitle: "掃描失敗",
    errorMessage: "請重新載入頁面後再試一次。",
    download: "下載",
    downloading: "正在啟動…",
    sentButton: "已交給 Chrome",
    retry: "再試一次",
    sentStatus: "已交給 Chrome 下載。",
    downloadError: "Chrome 無法啟動此下載，請再試一次。",
    unsupported: "不支援",
    sourceHost: "來源",
    capturedStreamTitle: "已擷取的影片串流",
    capturedStreamHint: "組合前請先將影片從頭到尾播放一次，以擷取所有片段。",
    assemble: "組合 MP4",
    fetchingParts: "正在下載串流片段…",
    muxing: "正在合併音訊與視訊…",
    assemblyError: "無法組合已擷取的串流，請從頭播放後再試一次。",
  },
};

export function resolveLocale(locale?: SupportedLocale): SupportedLocale {
  if (locale) return locale;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-TW" : "en";
}

export function getMessages(locale: SupportedLocale): Messages {
  return messages[locale];
}

export function unsupportedReason(
  locale: SupportedLocale,
  reason: "blob" | "hls" | "dash" | "media-stream",
): string {
  const reasons = {
    en: {
      blob: "Page-managed blob videos are not supported.",
      hls: "HLS streams are not supported.",
      dash: "DASH streams are not supported.",
      "media-stream": "Live media streams are not supported.",
    },
    "zh-TW": {
      blob: "目前不支援由頁面管理的 blob 影片。",
      hls: "目前不支援 HLS 串流。",
      dash: "目前不支援 DASH 串流。",
      "media-stream": "目前不支援即時媒體串流。",
    },
  } as const;
  return reasons[locale][reason];
}
