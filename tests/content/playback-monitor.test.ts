import { describe, expect, test, vi } from "vitest";
import {
  type PlaybackRuntime,
  startPlaybackMonitor,
} from "../../src/content/playback-monitor";

function setMediaState(
  video: HTMLVideoElement,
  state: {
    currentTime: number;
    duration: number;
    ended: boolean;
    paused: boolean;
  },
): void {
  for (const [name, value] of Object.entries(state)) {
    Object.defineProperty(video, name, { configurable: true, value });
  }
}

describe("startPlaybackMonitor", () => {
  test("reports bounded playback state and completion for existing videos", () => {
    const sendMessage = vi.fn((_message, callback?: () => void) =>
      callback?.(),
    );
    const runtime: PlaybackRuntime = { sendMessage };
    const video = document.createElement("video");
    setMediaState(video, {
      currentTime: 12,
      duration: 30,
      ended: false,
      paused: false,
    });
    document.body.append(video);

    const stop = startPlaybackMonitor(runtime);
    video.dispatchEvent(new Event("play"));
    setMediaState(video, {
      currentTime: 30,
      duration: 30,
      ended: true,
      paused: true,
    });
    video.dispatchEvent(new Event("ended"));

    expect(sendMessage).toHaveBeenCalledWith(
      {
        state: {
          currentTime: 12,
          duration: 30,
          ended: false,
          isPlaying: true,
          videoId: "1",
        },
        type: "playbackState",
      },
      expect.any(Function),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      {
        state: {
          currentTime: 30,
          duration: 30,
          ended: true,
          isPlaying: false,
          videoId: "1",
        },
        type: "videoEnded",
      },
      expect.any(Function),
    );

    const callCount = sendMessage.mock.calls.length;
    stop();
    video.dispatchEvent(new Event("timeupdate"));
    expect(sendMessage).toHaveBeenCalledTimes(callCount);
  });

  test("observes videos added after startup and omits source URLs from errors", async () => {
    const sendMessage = vi.fn((_message, callback?: () => void) =>
      callback?.(),
    );
    const stop = startPlaybackMonitor({ sendMessage });
    const video = document.createElement("video");
    video.src = "https://media.example/video.mp4?token=secret";
    setMediaState(video, {
      currentTime: 0,
      duration: Number.POSITIVE_INFINITY,
      ended: false,
      paused: true,
    });
    document.body.append(video);
    await Promise.resolve();

    video.dispatchEvent(new Event("durationchange"));
    video.dispatchEvent(new Event("error"));

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({ duration: 0 }),
        type: "playbackState",
      }),
      expect.any(Function),
    );
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain(
      "token=secret",
    );
    stop();
  });
});
