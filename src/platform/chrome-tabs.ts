import {
  collectVideoCandidates,
  type RawCollection,
} from "../content/collect-video-candidates";
import {
  type PlaybackProgress,
  parsePlaybackProgress,
} from "../core/playback-progress";
import {
  type VideoCandidate,
  validateCollectedVideos,
} from "../core/video-candidate";

interface ScriptOptions {
  target: { tabId: number };
  func: () => RawCollection;
  world: "ISOLATED";
}

export interface ChromeScanApi {
  tabs: {
    query(query: {
      active: boolean;
      currentWindow: boolean;
    }): Promise<Array<{ id?: number; title?: string; url?: string }>>;
  };
  scripting: {
    executeScript(
      options: ScriptOptions,
    ): Promise<Array<{ result?: RawCollection }>>;
  };
  runtime: {
    sendMessage(
      message: { type: string; tabId?: number },
      callback?: (response: unknown) => void,
    ): void;
  };
}

export interface CapturedVideo {
  url: string;
  mimeType: string;
  timestamp: number;
  range?: string;
}

export type ScanPageResult =
  | {
      status: "success";
      tabId: number;
      pageTitle: string;
      pageUrl: string;
      candidates: VideoCandidate[];
      iframeUrls: string[];
      capturedVideos: CapturedVideo[];
      playbackProgress: PlaybackProgress | null;
    }
  | { status: "restricted"; pageTitle: string }
  | { status: "error"; code: "no-active-tab" | "scan-failed" };

function defaultChromeApi(): ChromeScanApi {
  return {
    tabs: {
      query: (query) => chrome.tabs.query(query),
    },
    scripting: {
      executeScript: (options) => chrome.scripting.executeScript(options),
    },
    runtime: {
      sendMessage(message, callback) {
        const sendMessage = chrome.runtime.sendMessage as unknown as (
          value: { type: string; tabId?: number },
          responseCallback?: (response: unknown) => void,
        ) => void;
        sendMessage(message, callback);
      },
    },
  };
}

export function isRestrictedPageUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return true;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  return (
    (url.hostname === "chromewebstore.google.com" &&
      url.pathname.startsWith("/")) ||
    (url.hostname === "chrome.google.com" &&
      url.pathname.startsWith("/webstore"))
  );
}

async function fetchCaptureState(
  api: ChromeScanApi,
  tabId: number,
): Promise<{
  capturedVideos: CapturedVideo[];
  playbackProgress: PlaybackProgress | null;
}> {
  return new Promise((resolve) => {
    try {
      api.runtime.sendMessage(
        { type: "getCapturedVideos", tabId },
        (response: unknown) => {
          if (
            response &&
            typeof response === "object" &&
            "status" in response &&
            (response as { status: string }).status === "ok"
          ) {
            const result = response as Record<string, unknown>;
            const videos = result.videos as CapturedVideo[] | undefined;
            resolve({
              capturedVideos: Array.isArray(videos) ? videos : [],
              playbackProgress: parsePlaybackProgress(result.playback),
            });
          } else {
            resolve({ capturedVideos: [], playbackProgress: null });
          }
        },
      );
    } catch {
      resolve({ capturedVideos: [], playbackProgress: null });
    }
  });
}

export async function scanActivePage(
  api: ChromeScanApi = defaultChromeApi(),
): Promise<ScanPageResult> {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (
      !tab ||
      !Number.isInteger(tab.id) ||
      tab.id === undefined ||
      tab.id < 0
    ) {
      return { code: "no-active-tab", status: "error" };
    }
    if (!tab.url || isRestrictedPageUrl(tab.url)) {
      return {
        pageTitle: tab.title || "Restricted page",
        status: "restricted",
      };
    }

    const [injectionResult] = await api.scripting.executeScript({
      func: collectVideoCandidates,
      target: { tabId: tab.id },
      world: "ISOLATED",
    });
    if (!injectionResult || injectionResult.result === undefined) {
      return { code: "scan-failed", status: "error" };
    }

    const collection = validateCollectedVideos(injectionResult.result);

    const { capturedVideos, playbackProgress } = await fetchCaptureState(
      api,
      tab.id,
    );

    const iframeUrls = injectionResult.result.iframeUrls;

    return {
      candidates: collection.candidates,
      capturedVideos,
      iframeUrls,
      pageTitle: collection.pageTitle,
      pageUrl: collection.pageUrl,
      playbackProgress,
      status: "success",
      tabId: tab.id,
    };
  } catch {
    return { code: "scan-failed", status: "error" };
  }
}
