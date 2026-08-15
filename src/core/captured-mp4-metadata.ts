const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const MAX_INIT_BYTES = 2 * 1024 * 1024;
const MAX_TRACKS_PER_KIND = 32;
const MAX_SEGMENTS_PER_TRACK = 20_000;
const MAX_SEGMENT_REFERENCES = 50_000;
const MAX_URL_LENGTH = 8_192;

type JsonObject = Record<string, unknown>;

export type CapturedMp4TrackKind = "audio" | "video";

export interface CapturedMp4RequestLike {
  mimeType: string;
  url: string;
}

export interface EmbeddedMp4Initialization {
  bytes: ArrayBuffer;
  kind: CapturedMp4TrackKind;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedMimeType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function capturedMp4TrackKind(
  request: CapturedMp4RequestLike,
): CapturedMp4TrackKind | null {
  const mimeType = normalizedMimeType(request.mimeType);
  if (mimeType === "video/mp4") return "video";
  if (mimeType === "audio/mp4") return "audio";
  return null;
}

export function isCapturedMp4PlaylistMetadata(
  request: CapturedMp4RequestLike,
): boolean {
  const mimeType = normalizedMimeType(request.mimeType);
  if (mimeType !== "application/json" && mimeType !== "text/json") {
    return false;
  }
  try {
    const url = new URL(request.url);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname.endsWith("/playlist.json")
    );
  } catch {
    return false;
  }
}

function httpUrl(reference: unknown, base: string): string | null {
  if (
    typeof reference !== "string" ||
    reference.length === 0 ||
    reference.length > MAX_URL_LENGTH
  ) {
    return null;
  }
  try {
    const url = new URL(reference, base);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function baseUrl(reference: unknown, base: string): string | null {
  return reference === undefined || reference === ""
    ? httpUrl(".", base)
    : httpUrl(reference, base);
}

function decodeInitialization(value: unknown): ArrayBuffer | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil((MAX_INIT_BYTES * 4) / 3) + 4 ||
    !/^[a-z\d+/_-]*={0,2}$/i.test(value) ||
    value.length % 4 === 1
  ) {
    return null;
  }
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = atob(padded);
    if (decoded.length === 0 || decoded.length > MAX_INIT_BYTES) return null;
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
      .buffer;
  } catch {
    return null;
  }
}

interface TrackCandidate {
  initialization: ArrayBuffer;
  matchCount: number;
}

function chooseTrack(
  tracks: unknown,
  kind: CapturedMp4TrackKind,
  playlistBase: string,
  capturedUrls: Set<string>,
  referenceCount: { value: number },
): EmbeddedMp4Initialization | null {
  if (!Array.isArray(tracks) || tracks.length > MAX_TRACKS_PER_KIND) {
    return null;
  }

  const candidates: TrackCandidate[] = [];
  for (const value of tracks) {
    if (!isObject(value)) continue;
    const trackBase = baseUrl(value.base_url, playlistBase);
    const initialization = decodeInitialization(value.init_segment);
    if (!trackBase || !initialization || !Array.isArray(value.segments)) {
      continue;
    }
    if (value.segments.length > MAX_SEGMENTS_PER_TRACK) return null;
    referenceCount.value += value.segments.length;
    if (referenceCount.value > MAX_SEGMENT_REFERENCES) return null;

    const matchedUrls = new Set<string>();
    for (const segment of value.segments) {
      if (!isObject(segment)) continue;
      const url = httpUrl(segment.url, trackBase);
      if (url && capturedUrls.has(url)) matchedUrls.add(url);
    }
    if (matchedUrls.size > 0) {
      candidates.push({ initialization, matchCount: matchedUrls.size });
    }
  }

  candidates.sort((left, right) => right.matchCount - left.matchCount);
  const selected = candidates[0];
  if (!selected || candidates[1]?.matchCount === selected.matchCount) {
    return null;
  }
  return { bytes: selected.initialization, kind };
}

export function embeddedMp4Initializations(
  bytes: ArrayBuffer,
  metadataUrl: string,
  mediaRequests: CapturedMp4RequestLike[],
): EmbeddedMp4Initialization[] {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_METADATA_BYTES)
    return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    return [];
  }
  if (!isObject(parsed)) return [];
  const playlistBase = baseUrl(parsed.base_url, metadataUrl);
  if (!playlistBase) return [];

  const capturedUrls = new Map<CapturedMp4TrackKind, Set<string>>([
    ["audio", new Set()],
    ["video", new Set()],
  ]);
  for (const request of mediaRequests) {
    const kind = capturedMp4TrackKind(request);
    if (kind) capturedUrls.get(kind)?.add(request.url);
  }

  const referenceCount = { value: 0 };
  const initializations: EmbeddedMp4Initialization[] = [];
  for (const kind of ["video", "audio"] as const) {
    const initialization = chooseTrack(
      parsed[kind],
      kind,
      playlistBase,
      capturedUrls.get(kind) as Set<string>,
      referenceCount,
    );
    if (initialization) initializations.push(initialization);
  }
  return initializations;
}
