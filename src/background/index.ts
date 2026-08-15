/**
 * Background service worker that captures video URLs from network traffic.
 *
 * This allows the extension to discover video streams from cross-origin iframes
 * and other sources that the content script cannot directly access.
 */

const VIDEO_MIME_PATTERNS = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/x-m4v",
  "video/quicktime",
  "application/mp4",
  "application/octet-stream",
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
  // Video hosting CDNs
  "vimeocdn.com",
  "cloudfront.net",
  "akamai.net",
  "akamaized.net",
  "fastly.net",
  "googlevideo.com",
  "ytimg.com",
  "yotpoimgs.com",
  "player.vimeo.com",
  "player.youku.com",
  "coub.com",
  "dailymotion.com",
  "cdninstagram.com",
  // Custom hosts can be added here
]);

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

function isVideoUrl(url: string, contentType: string): boolean {
  // Check content type
  if (contentType) {
    const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (VIDEO_MIME_PATTERNS.has(normalized)) {
      return true;
    }
  }

  // Check file extension
  const ext = videoExtensionFromUrl(url);
  if (VIDEO_EXTENSIONS.has(ext)) {
    return true;
  }

  // Check for common video URL patterns
  if (
    url.includes("/video/") ||
    url.includes("/stream/") ||
    url.includes("/media/") ||
    url.includes("/assets/video/")
  ) {
    return true;
  }

  // Check for known video hosts
  try {
    const hostname = new URL(url).hostname;
    for (const videoHost of VIDEO_HOSTS) {
      if (hostname.includes(videoHost)) {
        return true;
      }
    }
  } catch {
    // Invalid URL, skip
  }

  return false;
}

interface VideoEntry {
  url: string;
  mimeType: string;
  timestamp: number;
  tabId: number;
}

const capturedVideos = new Map<number, VideoEntry[]>();
const CAPTURE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_VIDEOS_PER_TAB = 50;

function addToCaptures(tabId: number, entry: VideoEntry): void {
  if (tabId < 0) return;

  let videos = capturedVideos.get(tabId);
  if (!videos) {
    videos = [];
    capturedVideos.set(tabId, videos);
  }

  // Avoid duplicates
  if (videos.some((v) => v.url === entry.url)) {
    return;
  }

  videos.push(entry);

  // Cap the number of entries
  if (videos.length > MAX_VIDEOS_PER_TAB) {
    videos.shift();
  }
}

function cleanupStaleCaptures(): void {
  const now = Date.now();
  for (const [tabId, videos] of capturedVideos.entries()) {
    const hasRecent = videos.some(
      (v) => now - v.timestamp < CAPTURE_TIMEOUT_MS,
    );
    if (!hasRecent) {
      capturedVideos.delete(tabId);
    }
  }
}

// Clean up periodically
chrome.alarms.create("cleanup", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cleanup") {
    cleanupStaleCaptures();
  }
});

// Remove when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  capturedVideos.delete(tabId);
});

// Intercept response headers to capture video URLs
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const contentType = details.responseHeaders?.find(
      (h) => h.name.toLowerCase() === "content-type",
    );
    const mimeType = contentType?.value ?? "";
    const url = details.url;

    if (isVideoUrl(url, mimeType)) {
      const entry: VideoEntry = {
        url,
        mimeType,
        timestamp: Date.now(),
        tabId: details.tabId,
      };

      addToCaptures(details.tabId, entry);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"],
);

// Also capture on response start for better timing
chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    const contentType = details.responseHeaders?.find(
      (h) => h.name.toLowerCase() === "content-type",
    );
    const mimeType = contentType?.value ?? "";
    const url = details.url;

    if (isVideoUrl(url, mimeType)) {
      const entry: VideoEntry = {
        url,
        mimeType,
        timestamp: Date.now(),
        tabId: details.tabId,
      };

      addToCaptures(details.tabId, entry);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"],
);

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener(
  (
    message: {
      type: string;
      tabId?: number;
      action?: string;
    },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message.type === "getCapturedVideos") {
      const tabId = message.tabId ?? -1;
      const videos = tabId >= 0 ? (capturedVideos.get(tabId) ?? []) : [];
      sendResponse({
        status: "ok",
        videos,
        tabId,
      });
      return true;
    }

    if (message.type === "clearCapturedVideos") {
      if (message.tabId !== undefined) {
        capturedVideos.delete(message.tabId);
      } else {
        capturedVideos.clear();
      }
      sendResponse({ status: "ok" });
      return true;
    }

    if (message.type === "captureFromIframe") {
      // Content script can signal that a video was found in an iframe
      if (message.tabId !== undefined) {
        const entry: VideoEntry = {
          url: "iframe-detected",
          mimeType: "iframe/video",
          timestamp: Date.now(),
          tabId: message.tabId,
        };
        addToCaptures(message.tabId, entry);
      }
      sendResponse({ status: "ok" });
      return true;
    }

    sendResponse({ status: "unknown-message" });
    return true;
  },
);

// Notify popup when new videos are captured
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete" && capturedVideos.has(tabId)) {
    // The videos are already in memory, no need to notify
    // The popup will poll or request the videos when opened
  }
});
