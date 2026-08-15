import {
  capturedMp4TrackKind,
  isCapturedMp4PlaylistMetadata,
} from "../core/captured-mp4-metadata";
import type { PlaybackSnapshot } from "../core/playback-progress";

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

interface PlaybackEntry extends PlaybackSnapshot {
  assemblyReady: boolean;
  timestamp: number;
}

type PlaybackStore = Record<string, PlaybackEntry>;

const STORAGE_KEY = "capturedVideosByTab";
const PLAYBACK_STORAGE_KEY = "playbackByTab";
const CAPTURE_TIMEOUT_MS = 5 * 60 * 1000;
const ASSEMBLY_READY_DELAY_MS = 3_000;
const ASSEMBLY_ALARM_PREFIX = "assembly-ready:";
const MAX_PLAYBACK_SECONDS = 7 * 24 * 60 * 60;
const MAX_VIDEOS_PER_TAB = 1_000;
const requestRanges = new Map<string, string>();
let storageQueue: Promise<void> = Promise.resolve();
let playbackStorageQueue: Promise<void> = Promise.resolve();

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

function parsePlaybackStore(value: unknown): PlaybackStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as PlaybackStore;
}

async function readPlaybackStore(): Promise<PlaybackStore> {
  const result = await chrome.storage.session.get(PLAYBACK_STORAGE_KEY);
  return parsePlaybackStore(result[PLAYBACK_STORAGE_KEY]);
}

function updatePlaybackStore(
  update: (store: PlaybackStore) => void,
): Promise<void> {
  const operation = playbackStorageQueue.then(async () => {
    const store = await readPlaybackStore();
    update(store);
    await chrome.storage.session.set({ [PLAYBACK_STORAGE_KEY]: store });
  });
  playbackStorageQueue = operation.catch(() => undefined);
  return operation;
}

async function playbackForTab(tabId: number): Promise<PlaybackEntry | null> {
  await playbackStorageQueue;
  const store = await readPlaybackStore();
  return store[String(tabId)] ?? null;
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

function assemblyAlarmName(tabId: number): string {
  return `${ASSEMBLY_ALARM_PREFIX}${tabId}`;
}

function clearTab(tabId: number): Promise<void> {
  void chrome.alarms.clear(assemblyAlarmName(tabId));
  return Promise.all([
    updateStore((store) => {
      delete store[String(tabId)];
    }),
    updatePlaybackStore((store) => {
      delete store[String(tabId)];
    }),
  ]).then(() => undefined);
}

function cleanupStaleCaptures(): Promise<void> {
  const now = Date.now();
  return Promise.all([
    updateStore((store) => {
      for (const [tabId, videos] of Object.entries(store)) {
        if (
          !videos.some((video) => now - video.timestamp < CAPTURE_TIMEOUT_MS)
        ) {
          delete store[tabId];
        }
      }
    }),
    updatePlaybackStore((store) => {
      for (const [tabId, playback] of Object.entries(store)) {
        if (now - playback.timestamp >= CAPTURE_TIMEOUT_MS) {
          delete store[tabId];
          void chrome.alarms.clear(assemblyAlarmName(Number(tabId)));
        }
      }
    }),
  ]).then(() => undefined);
}

function broadcast(message: unknown): void {
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // No extension page may be listening while the popup is closed.
  }
}

async function markAssemblyReady(tabId: number): Promise<void> {
  let playback: PlaybackEntry | null = null;
  await updatePlaybackStore((store) => {
    const current = store[String(tabId)];
    if (!current?.ended) return;
    playback = { ...current, assemblyReady: true };
    store[String(tabId)] = playback;
  });
  if (!playback) return;

  const videos = (await videosForTab(tabId)).filter(
    (video) =>
      capturedMp4TrackKind(video) !== null ||
      isCapturedMp4PlaylistMetadata(video),
  );
  broadcast({ playback, tabId, type: "triggerAssembly", videos });
}

chrome.alarms.create("cleanup", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cleanup") {
    void cleanupStaleCaptures();
    return;
  }
  if (!alarm.name.startsWith(ASSEMBLY_ALARM_PREFIX)) return;
  const tabId = Number(alarm.name.slice(ASSEMBLY_ALARM_PREFIX.length));
  if (Number.isInteger(tabId) && tabId >= 0) void markAssemblyReady(tabId);
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

function validPlaybackSnapshot(value: unknown): PlaybackSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PlaybackSnapshot>;
  if (
    typeof candidate.currentTime !== "number" ||
    !Number.isFinite(candidate.currentTime) ||
    candidate.currentTime < 0 ||
    candidate.currentTime > MAX_PLAYBACK_SECONDS ||
    typeof candidate.duration !== "number" ||
    !Number.isFinite(candidate.duration) ||
    candidate.duration < 0 ||
    candidate.duration > MAX_PLAYBACK_SECONDS ||
    typeof candidate.ended !== "boolean" ||
    typeof candidate.isPlaying !== "boolean" ||
    typeof candidate.videoId !== "string" ||
    candidate.videoId.length === 0 ||
    candidate.videoId.length > 128
  ) {
    return null;
  }
  return candidate as PlaybackSnapshot;
}

function senderTabId(sender: chrome.runtime.MessageSender): number | null {
  const tabId = sender.tab?.id;
  return Number.isInteger(tabId) && tabId !== undefined && tabId >= 0
    ? tabId
    : null;
}

function recordPlayback(
  tabId: number,
  state: PlaybackSnapshot,
): Promise<PlaybackEntry> {
  let playback: PlaybackEntry = {
    ...state,
    assemblyReady: false,
    timestamp: Date.now(),
  };
  return updatePlaybackStore((store) => {
    const previous = store[String(tabId)];
    playback = {
      ...state,
      assemblyReady: state.ended && (previous?.assemblyReady ?? false),
      timestamp: Date.now(),
    };
    store[String(tabId)] = playback;
  }).then(() => playback);
}

chrome.runtime.onMessage.addListener(
  (
    message: { state?: unknown; tabId?: number; type: string },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message.type === "getCapturedVideos") {
      const tabId = message.tabId ?? -1;
      void Promise.all([videosForTab(tabId), playbackForTab(tabId)])
        .then(([videos, playback]) =>
          sendResponse({ playback, status: "ok", tabId, videos }),
        )
        .catch(() =>
          sendResponse({
            playback: null,
            status: "error",
            tabId,
            videos: [],
          }),
        );
      return true;
    }

    if (message.type === "clearCapturedVideos") {
      const operation =
        message.tabId === undefined
          ? Promise.all([
              updateStore((store) => {
                for (const tabId of Object.keys(store)) delete store[tabId];
              }),
              updatePlaybackStore((store) => {
                for (const tabId of Object.keys(store)) {
                  void chrome.alarms.clear(assemblyAlarmName(Number(tabId)));
                  delete store[tabId];
                }
              }),
            ])
          : clearTab(message.tabId);
      void operation
        .then(() => sendResponse({ status: "ok" }))
        .catch(() => sendResponse({ status: "error" }));
      return true;
    }

    if (message.type === "playbackState" || message.type === "videoEnded") {
      const tabId = senderTabId(sender);
      const state = validPlaybackSnapshot(message.state);
      if (tabId === null || !state) {
        sendResponse({ status: "invalid-playback-state" });
        return false;
      }

      const ended = message.type === "videoEnded";
      const normalized = ended
        ? { ...state, ended: true, isPlaying: false }
        : state;
      void recordPlayback(tabId, normalized)
        .then((playback) => {
          broadcast({ playback, tabId, type: "playbackProgress" });
          if (ended) {
            chrome.alarms.create(assemblyAlarmName(tabId), {
              when: Date.now() + ASSEMBLY_READY_DELAY_MS,
            });
          } else if (!playback.ended) {
            void chrome.alarms.clear(assemblyAlarmName(tabId));
          }
          sendResponse({ status: "ok" });
        })
        .catch(() => sendResponse({ status: "error" }));
      return true;
    }

    if (message.type === "videoError") {
      sendResponse({ status: "ok" });
      return false;
    }

    sendResponse({ status: "unknown-message" });
    return false;
  },
);
