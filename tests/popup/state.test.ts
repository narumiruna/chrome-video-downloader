import { describe, expect, test } from "vitest";
import type { VideoCandidate } from "../../src/core/video-candidate";
import { initialState, popupReducer } from "../../src/popup/state";

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

describe("popupReducer", () => {
  test("maps scan results to found, unsupported, empty, restricted, and error states", () => {
    const found = popupReducer(initialState, {
      type: "scan-succeeded",
      candidates: [hls, direct],
      capturedVideos: [],
      iframeUrls: [],
      pageTitle: "Fixture",
      pageUrl: "https://example.com",
    });
    expect(found.scan.status).toBe("found");

    const unsupported = popupReducer(found, {
      type: "scan-succeeded",
      candidates: [hls],
      capturedVideos: [],
      iframeUrls: [],
      pageTitle: "Fixture",
      pageUrl: "https://example.com",
    });
    expect(unsupported.scan.status).toBe("unsupported-stream");

    const empty = popupReducer(found, {
      type: "scan-succeeded",
      candidates: [],
      capturedVideos: [],
      iframeUrls: [],
      pageTitle: "Fixture",
      pageUrl: "https://example.com",
    });
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
    const found = popupReducer(initialState, {
      type: "scan-succeeded",
      candidates: [direct, { ...direct, id: "second" }],
      capturedVideos: [],
      iframeUrls: [],
      pageTitle: "Fixture",
      pageUrl: "https://example.com",
    });
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

  test("ignores download updates for candidates that are no longer present", () => {
    const state = popupReducer(initialState, {
      type: "download-started",
      id: "stale",
    });
    expect(state).toBe(initialState);
  });
});
