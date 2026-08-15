export interface PlaybackSnapshot {
  currentTime: number;
  duration: number;
  ended: boolean;
  isPlaying: boolean;
  videoId: string;
}

export interface PlaybackProgress extends PlaybackSnapshot {
  assemblyReady: boolean;
  timestamp: number;
}

const MAX_PLAYBACK_SECONDS = 7 * 24 * 60 * 60;

export function parsePlaybackProgress(value: unknown): PlaybackProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PlaybackProgress>;
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
    candidate.videoId.length > 128 ||
    typeof candidate.assemblyReady !== "boolean" ||
    typeof candidate.timestamp !== "number" ||
    !Number.isFinite(candidate.timestamp) ||
    candidate.timestamp < 0
  ) {
    return null;
  }
  return candidate as PlaybackProgress;
}
