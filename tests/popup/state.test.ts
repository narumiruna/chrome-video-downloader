import { describe, expect, test } from "vitest";
import type { PlaybackProgress } from "../../src/core/playback-progress";
import type { VideoCandidate } from "../../src/core/video-candidate";
import {
  initialState,
  type PopupAction,
  popupReducer,
} from "../../src/popup/state";

const direct: VideoCandidate = {
  id: "direct",
  displayName: "video.mp4",
  format: "MP4",
  hostname: "cdn.example.com",
  sourceType: "direct",
  support: { status: "downloadable" },
  url: "https://cdn.example.com/video.mp4",
};
const hls: VideoCandidate = {
  ...direct,
  id: "hls",
  displayName: "HLS stream",
  format: "HLS",
  sourceType: "hls",
  support: { reason: "hls", status: "unsupported" },
  url: "https://cdn.example.com/master.m3u8",
};
const playback: PlaybackProgress = {
  assemblyReady: false,
  currentTime: 20,
  duration: 60,
  ended: false,
  isPlaying: true,
  timestamp: 1,
  videoId: "1",
};

function scanSucceeded(candidates: VideoCandidate[]): PopupAction {
  return {
    type: "scan-succeeded",
    candidates,
    capturedVideos: [],
    iframeUrls: [],
    pageTitle: "Fixture",
    pageUrl: "https://example.com",
    playbackProgress: null,
    tabId: 7,
  };
}

describe("popupReducer", () => {
  test("maps scan results to found, unsupported, empty, restricted, and error states", () => {
    const found = popupReducer(initialState, scanSucceeded([hls, direct]));
    expect(found.scan.status).toBe("found");

    const unsupported = popupReducer(found, scanSucceeded([hls]));
    expect(unsupported.scan.status).toBe("unsupported-stream");

    const empty = popupReducer(found, scanSucceeded([]));
    expect(empty.scan.status).toBe("empty");

    expect(
      popupReducer(found, { type: "scan-restricted", pageTitle: "Extensions" })
        .scan,
    ).toEqual({ pageTitle: "Extensions", status: "restricted" });
    expect(popupReducer(found, { type: "scan-failed" }).scan).toEqual({
      status: "error",
    });
  });

  test("tracks each download independently and clears stale state on rescan", () => {
    const found = popupReducer(
      initialState,
      scanSucceeded([direct, { ...direct, id: "second" }]),
    );
    const starting = popupReducer(found, {
      type: "download-started",
      id: "direct",
    });
    expect(starting.downloads).toEqual({ direct: "starting" });

    const accepted = popupReducer(starting, {
      type: "download-accepted",
      id: "direct",
    });
    expect(accepted.downloads).toEqual({ direct: "accepted" });

    const secondFailed = popupReducer(accepted, {
      type: "download-failed",
      id: "second",
    });
    expect(secondFailed.downloads).toEqual({
      direct: "accepted",
      second: "error",
    });

    expect(popupReducer(secondFailed, { type: "scan-started" })).toEqual(
      initialState,
    );
  });

  test("tracks playback, assembly progress, and refreshed parts for the active tab", () => {
    const scanned = popupReducer(initialState, scanSucceeded([]));
    const playing = popupReducer(scanned, {
      type: "playback-progress-update",
      playback,
    });
    expect(playing.playbackProgress).toEqual(playback);

    const fetching = popupReducer(playing, {
      type: "assembly-progress",
      assembly: { status: "fetching", completed: 2, total: 4 },
    });
    expect(fetching.assembly).toEqual({
      status: "fetching",
      completed: 2,
      total: 4,
    });

    const readyPlayback = {
      ...playback,
      assemblyReady: true,
      currentTime: 60,
      ended: true,
      isPlaying: false,
    };
    const ready = popupReducer(fetching, {
      type: "assembly-ready",
      capturedVideos: [
        { mimeType: "video/mp4", timestamp: 2, url: "https://example/v.m4s" },
      ],
      playback: readyPlayback,
      tabId: 7,
    });
    expect(ready.playbackProgress).toEqual(readyPlayback);
    expect(
      ready.scan.status === "empty" ? ready.scan.capturedVideos : [],
    ).toHaveLength(1);

    expect(
      popupReducer(ready, {
        type: "assembly-ready",
        capturedVideos: [],
        playback: readyPlayback,
        tabId: 8,
      }),
    ).toBe(ready);
  });

  test("ignores download updates for candidates that are no longer present", () => {
    const state = popupReducer(initialState, {
      type: "download-started",
      id: "stale",
    });
    expect(state).toBe(initialState);
  });
});
