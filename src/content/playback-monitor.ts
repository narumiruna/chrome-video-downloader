import type { PlaybackSnapshot } from "../core/playback-progress";

export interface PlaybackRuntime {
  sendMessage(message: unknown, callback?: () => void): void;
}

const UPDATE_INTERVAL_MS = 500;

function finiteMediaTime(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function snapshot(
  video: HTMLVideoElement,
  videoId: string,
  ended = video.ended,
): PlaybackSnapshot {
  return {
    currentTime: finiteMediaTime(video.currentTime),
    duration: finiteMediaTime(video.duration),
    ended,
    isPlaying: !ended && !video.paused,
    videoId,
  };
}

function send(runtime: PlaybackRuntime, message: unknown): void {
  try {
    runtime.sendMessage(message, () => {
      // Reading lastError prevents a console warning if the extension reloads.
      if (typeof chrome !== "undefined") void chrome.runtime.lastError;
    });
  } catch {
    // The extension context can disappear while a page remains open.
  }
}

export function startPlaybackMonitor(
  runtime: PlaybackRuntime = chrome.runtime,
): () => void {
  const watched = new Map<
    HTMLVideoElement,
    { cleanup: () => void; lastUpdate: number; videoId: string }
  >();
  let nextVideoId = 1;

  const watch = (video: HTMLVideoElement): void => {
    if (watched.has(video)) return;

    const videoId = String(nextVideoId);
    nextVideoId += 1;
    const sendState = (force = false, ended = video.ended): void => {
      const registration = watched.get(video);
      if (!registration) return;
      const now = Date.now();
      if (!force && now - registration.lastUpdate < UPDATE_INTERVAL_MS) return;
      registration.lastUpdate = now;
      send(runtime, {
        state: snapshot(video, registration.videoId, ended),
        type: "playbackState",
      });
    };
    const onTimeUpdate = () => sendState();
    const onPlay = () => sendState(true, false);
    const onDurationChange = () => sendState(true);
    const onEnded = () => {
      sendState(true, true);
      send(runtime, {
        state: snapshot(video, videoId, true),
        type: "videoEnded",
      });
    };
    const onError = () => {
      send(runtime, { type: "videoError", videoId });
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    watched.set(video, {
      lastUpdate: 0,
      videoId,
      cleanup: () => {
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("play", onPlay);
        video.removeEventListener("durationchange", onDurationChange);
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("error", onError);
      },
    });
  };

  const scanNode = (node: Node): void => {
    if (node instanceof HTMLVideoElement) watch(node);
    if (!(node instanceof Element)) return;
    for (const video of node.querySelectorAll("video")) watch(video);
  };
  const release = (video: HTMLVideoElement): void => {
    if (video.isConnected) return;
    const registration = watched.get(video);
    if (!registration) return;
    registration.cleanup();
    watched.delete(video);
  };
  const releaseNode = (node: Node): void => {
    if (node instanceof HTMLVideoElement) release(node);
    if (!(node instanceof Element)) return;
    for (const video of node.querySelectorAll("video")) release(video);
  };

  for (const video of document.querySelectorAll("video")) watch(video);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) releaseNode(node);
      for (const node of mutation.addedNodes) scanNode(node);
    }
  });
  observer.observe(document, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    for (const registration of watched.values()) registration.cleanup();
    watched.clear();
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  startPlaybackMonitor();
}
