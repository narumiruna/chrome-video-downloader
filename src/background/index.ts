import { isCapturedMp4PlaylistMetadata } from "../core/captured-mp4-metadata";

const VIDEO_MIME_PATTERNS = new Set([
  "audio/mp4",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/x-m4v",
  "video/quicktime",
  "application/mp4",
  "application/x-mpegurl",
  "application/vnd.apple.mpegurl",
  "application/dash+xml",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "webm",
  "ogg",
  "m4v",
  "mov",
  "m4s",
  "ts",
  "m3u8",
  "mpd",
]);

const VIDEO_HOSTS = new Set([
  "vimeocdn.com",
  "cloudfront.net",
  "akamai.net",
  "akamaized.net",
  "fastly.net",
  "googlevideo.com",
  "ytimg.com",
  "player.vimeo.com",
  "player.youku.com",
  "coub.com",
  "dailymotion.com",
  "cdninstagram.com",
]);

interface VideoEntry {
  url: string;
  mimeType: string;
  timestamp: number;
  tabId: number;
  range?: string;
}

type CaptureStore = Record<string, VideoEntry[]>;

const STORAGE_KEY = "capturedVideosByTab";
const CAPTURE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_VIDEOS_PER_TAB = 1_000;
const requestRanges = new Map<string, string>();
let storageQueue: Promise<void> = Promise.resolve();

function videoExtensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").pop() ?? "";
    const dotIndex = filename.lastIndexOf(".");
    return dotIndex < 0 ? "" : filename.slice(dotIndex + 1).toLowerCase();
  } catch {
    return "";
  }
}

function isKnownVideoHost(hostname: string): boolean {
  for (const videoHost of VIDEO_HOSTS) {
    if (hostname === videoHost || hostname.endsWith(`.${videoHost}`)) {
      return true;
    }
  }
  return false;
}

function isVideoUrl(url: string, contentType: string): boolean {
  const normalizedType =
    contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (isCapturedMp4PlaylistMetadata({ mimeType: contentType, url }))
    return true;
  if (VIDEO_MIME_PATTERNS.has(normalizedType)) return true;
  if (VIDEO_EXTENSIONS.has(videoExtensionFromUrl(url))) return true;

  try {
    const parsed = new URL(url);
    return (
      parsed.pathname.includes("/video/") ||
      parsed.pathname.includes("/stream/") ||
      parsed.pathname.includes("/media/") ||
      parsed.pathname.includes("/assets/video/") ||
      (normalizedType === "application/octet-stream" &&
        isKnownVideoHost(parsed.hostname))
    );
  } catch {
    return false;
  }
}

function parseStore(value: unknown): CaptureStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as CaptureStore;
}

async function readStore(): Promise<CaptureStore> {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return parseStore(result[STORAGE_KEY]);
}

function updateStore(update: (store: CaptureStore) => void): Promise<void> {
  const operation = storageQueue.then(async () => {
    const store = await readStore();
    update(store);
    await chrome.storage.session.set({ [STORAGE_KEY]: store });
  });
  storageQueue = operation.catch(() => undefined);
  return operation;
}

async function videosForTab(tabId: number): Promise<VideoEntry[]> {
  await storageQueue;
  const store = await readStore();
  return store[String(tabId)] ?? [];
}

function addToCaptures(tabId: number, entry: VideoEntry): void {
  if (tabId < 0) return;

  void updateStore((store) => {
    const key = String(tabId);
    const videos = store[key] ?? [];
    if (
      videos.some(
        (video) => video.url === entry.url && video.range === entry.range,
      )
    ) {
      return;
    }

    videos.push(entry);
    if (videos.length > MAX_VIDEOS_PER_TAB) videos.shift();
    store[key] = videos;
  });
}

function clearTab(tabId: number): Promise<void> {
  return updateStore((store) => {
    delete store[String(tabId)];
  });
}

function cleanupStaleCaptures(): Promise<void> {
  const now = Date.now();
  return updateStore((store) => {
    for (const [tabId, videos] of Object.entries(store)) {
      if (!videos.some((video) => now - video.timestamp < CAPTURE_TIMEOUT_MS)) {
        delete store[tabId];
      }
    }
  });
}

chrome.alarms.create("cleanup", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cleanup") void cleanupStaleCaptures();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") void clearTab(tabId);
});

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const range = details.requestHeaders?.find(
      (header) => header.name.toLowerCase() === "range",
    )?.value;
    if (range) requestRanges.set(details.requestId, range);
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"],
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const contentType = details.responseHeaders?.find(
      (header) => header.name.toLowerCase() === "content-type",
    );
    const mimeType = contentType?.value ?? "";
    if (!isVideoUrl(details.url, mimeType)) return;

    const range = requestRanges.get(details.requestId);
    addToCaptures(details.tabId, {
      url: details.url,
      mimeType,
      timestamp: Date.now(),
      tabId: details.tabId,
      ...(range ? { range } : {}),
    });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"],
);

function forgetRequest(details: { requestId: string }): void {
  requestRanges.delete(details.requestId);
}

chrome.webRequest.onCompleted.addListener(forgetRequest, {
  urls: ["<all_urls>"],
});
chrome.webRequest.onErrorOccurred.addListener(forgetRequest, {
  urls: ["<all_urls>"],
});

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; tabId?: number },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message.type === "getCapturedVideos") {
      const tabId = message.tabId ?? -1;
      void videosForTab(tabId)
        .then((videos) => sendResponse({ status: "ok", tabId, videos }))
        .catch(() => sendResponse({ status: "error", tabId, videos: [] }));
      return true;
    }

    if (message.type === "clearCapturedVideos") {
      const operation =
        message.tabId === undefined
          ? updateStore((store) => {
              for (const tabId of Object.keys(store)) delete store[tabId];
            })
          : clearTab(message.tabId);
      void operation
        .then(() => sendResponse({ status: "ok" }))
        .catch(() => sendResponse({ status: "error" }));
      return true;
    }

    sendResponse({ status: "unknown-message" });
    return false;
  },
);
