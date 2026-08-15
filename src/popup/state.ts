import type { PlaybackProgress } from "../core/playback-progress";
import type { VideoCandidate } from "../core/video-candidate";

export type DownloadState = "starting" | "accepted" | "error";

export interface CapturedVideo {
  url: string;
  mimeType: string;
  timestamp: number;
  range?: string;
}

export type AssemblyView =
  | { status: "idle" }
  | { status: "fetching" | "muxing"; completed: number; total: number }
  | { status: "accepted" | "error" };

export type ScanView =
  | { status: "scanning" }
  | {
      status: "found" | "unsupported-stream" | "empty";
      candidates: VideoCandidate[];
      capturedVideos: CapturedVideo[];
      iframeUrls: string[];
      pageTitle: string;
      pageUrl: string;
      tabId: number;
    }
  | { status: "restricted"; pageTitle: string }
  | { status: "error" };

export interface PopupState {
  assembly: AssemblyView;
  scan: ScanView;
  downloads: Record<string, DownloadState>;
  playbackProgress: PlaybackProgress | null;
}

export type PopupAction =
  | { type: "scan-started" }
  | {
      type: "scan-succeeded";
      candidates: VideoCandidate[];
      capturedVideos: CapturedVideo[];
      iframeUrls: string[];
      pageTitle: string;
      pageUrl: string;
      playbackProgress: PlaybackProgress | null;
      tabId: number;
    }
  | { type: "scan-restricted"; pageTitle: string }
  | { type: "scan-failed" }
  | {
      type: "download-started" | "download-accepted" | "download-failed";
      id: string;
    }
  | { type: "assembly-progress"; assembly: AssemblyView }
  | { type: "playback-progress-update"; playback: PlaybackProgress }
  | {
      type: "assembly-ready";
      capturedVideos: CapturedVideo[];
      playback: PlaybackProgress;
      tabId: number;
    };

export const initialState: PopupState = {
  assembly: { status: "idle" },
  downloads: {},
  playbackProgress: null,
  scan: { status: "scanning" },
};

function hasCandidate(state: PopupState, id: string): boolean {
  return (
    (state.scan.status === "found" ||
      state.scan.status === "unsupported-stream") &&
    state.scan.candidates.some((candidate) => candidate.id === id)
  );
}

function scanStatus(
  candidates: VideoCandidate[],
): Extract<
  ScanView,
  { status: "found" | "unsupported-stream" | "empty" }
>["status"] {
  if (candidates.length === 0) return "empty";
  return candidates.some(({ support }) => support.status === "downloadable")
    ? "found"
    : "unsupported-stream";
}

export function popupReducer(
  state: PopupState,
  action: PopupAction,
): PopupState {
  switch (action.type) {
    case "scan-started":
      return initialState;
    case "scan-succeeded":
      return {
        assembly: { status: "idle" },
        downloads: {},
        playbackProgress: action.playbackProgress,
        scan: {
          candidates: action.candidates,
          capturedVideos: action.capturedVideos,
          iframeUrls: action.iframeUrls,
          pageTitle: action.pageTitle,
          pageUrl: action.pageUrl,
          status: scanStatus(action.candidates),
          tabId: action.tabId,
        },
      };
    case "scan-restricted":
      return {
        ...initialState,
        scan: { pageTitle: action.pageTitle, status: "restricted" },
      };
    case "scan-failed":
      return { ...initialState, scan: { status: "error" } };
    case "download-started":
    case "download-accepted":
    case "download-failed": {
      if (!hasCandidate(state, action.id)) return state;
      const downloadState: DownloadState =
        action.type === "download-started"
          ? "starting"
          : action.type === "download-accepted"
            ? "accepted"
            : "error";
      return {
        ...state,
        downloads: { ...state.downloads, [action.id]: downloadState },
      };
    }
    case "assembly-progress":
      return { ...state, assembly: action.assembly };
    case "playback-progress-update":
      return { ...state, playbackProgress: action.playback };
    case "assembly-ready":
      if (
        state.scan.status !== "found" &&
        state.scan.status !== "unsupported-stream" &&
        state.scan.status !== "empty"
      ) {
        return state;
      }
      if (state.scan.tabId !== action.tabId) return state;
      return {
        ...state,
        playbackProgress: action.playback,
        scan: {
          ...state.scan,
          capturedVideos: action.capturedVideos,
        },
      };
  }
}
