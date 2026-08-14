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
}

const messages: Record<SupportedLocale, Messages> = {
  en: {
    appName: "Video Downloader",
    rightsNotice: "Download only videos you own or have permission to save.",
    privacyNotice:
      "No page or video URL is collected, saved, or sent to the developer.",
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
  },
  "zh-TW": {
    appName: "影片下載器",
    rightsNotice: "請只下載您擁有或獲授權保存的影片。",
    privacyNotice: "開發者不會收集、儲存或接收頁面或影片網址。",
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
