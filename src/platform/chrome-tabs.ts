import {
  collectVideoCandidates,
  type RawCollection,
} from "../content/collect-video-candidates";
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
    executeScript(options: ScriptOptions): Promise<Array<{ result?: unknown }>>;
  };
}

export type ScanPageResult =
  | {
      status: "success";
      pageTitle: string;
      pageUrl: string;
      candidates: VideoCandidate[];
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
    return {
      candidates: collection.candidates,
      pageTitle: collection.pageTitle,
      pageUrl: collection.pageUrl,
      status: "success",
    };
  } catch {
    return { code: "scan-failed", status: "error" };
  }
}
