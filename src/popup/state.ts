import type { VideoCandidate } from "../core/video-candidate";

export type DownloadState = "starting" | "accepted" | "error";

export type ScanView =
  | { status: "scanning" }
  | {
      status: "found" | "unsupported-stream" | "empty";
      candidates: VideoCandidate[];
      pageTitle: string;
      pageUrl: string;
    }
  | { status: "restricted"; pageTitle: string }
  | { status: "error" };

export interface PopupState {
  scan: ScanView;
  downloads: Record<string, DownloadState>;
}

export type PopupAction =
  | { type: "scan-started" }
  | {
      type: "scan-succeeded";
      candidates: VideoCandidate[];
      pageTitle: string;
      pageUrl: string;
    }
  | { type: "scan-restricted"; pageTitle: string }
  | { type: "scan-failed" }
  | {
      type: "download-started" | "download-accepted" | "download-failed";
      id: string;
    };

export const initialState: PopupState = {
  downloads: {},
  scan: { status: "scanning" },
};

function hasCandidate(state: PopupState, id: string): boolean {
  return (
    (state.scan.status === "found" ||
      state.scan.status === "unsupported-stream") &&
    state.scan.candidates.some((candidate) => candidate.id === id)
  );
}

export function popupReducer(
  state: PopupState,
  action: PopupAction,
): PopupState {
  switch (action.type) {
    case "scan-started":
      return initialState;
    case "scan-succeeded": {
      const hasDownload = action.candidates.some(
        ({ support }) => support.status === "downloadable",
      );
      return {
        downloads: {},
        scan: {
          candidates: action.candidates,
          pageTitle: action.pageTitle,
          pageUrl: action.pageUrl,
          status:
            action.candidates.length === 0
              ? "empty"
              : hasDownload
                ? "found"
                : "unsupported-stream",
        },
      };
    }
    case "scan-restricted":
      return {
        downloads: {},
        scan: { pageTitle: action.pageTitle, status: "restricted" },
      };
    case "scan-failed":
      return { downloads: {}, scan: { status: "error" } };
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
  }
}
