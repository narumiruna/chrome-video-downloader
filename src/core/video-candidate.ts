import {
  classifyVideoSource,
  type RawSourceKind,
  type UnsupportedSourceType,
} from "./classify-video-source";

const MAX_CANDIDATES = 50;
const MAX_RAW_CANDIDATES = 200;
const MAX_URL_LENGTH = 8_192;
const MAX_TITLE_LENGTH = 200;
const MAX_MEDIA_TYPE_LENGTH = 256;
const MAX_DIMENSION = 16_384;
const MAX_DURATION_SECONDS = 604_800;

export interface DownloadableSupport {
  status: "downloadable";
}

export interface UnsupportedSupport {
  status: "unsupported";
  reason: UnsupportedSourceType;
}

export interface VideoCandidate {
  id: string;
  url: string;
  displayName: string;
  hostname: string;
  format: string;
  sourceType: "direct" | UnsupportedSourceType;
  support: DownloadableSupport | UnsupportedSupport;
  width?: number;
  height?: number;
  duration?: number;
}

export interface ValidatedCollection {
  pageTitle: string;
  pageUrl: string;
  candidates: VideoCandidate[];
}

interface CandidateWithOrder extends VideoCandidate {
  order: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: string, maxLength: number): string {
  let cleaned = "";
  let inspected = 0;
  for (const character of value) {
    if (inspected >= maxLength * 2) break;
    inspected += 1;
    const code = character.codePointAt(0) ?? 0;
    const isControl = code < 32 || (code >= 127 && code <= 159);
    const isBidirectionalControl =
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0x200e ||
      code === 0x200f;
    cleaned += isControl || isBidirectionalControl ? " " : character;
  }
  return Array.from(cleaned.replace(/\s+/g, " ").trim())
    .slice(0, maxLength)
    .join("");
}

function safeString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? cleanText(value, maxLength) : "";
}

function isSourceKind(value: unknown): value is RawSourceKind {
  return (
    value === "media-element" ||
    value === "source-element" ||
    value === "performance" ||
    value === "media-stream"
  );
}

function safePositiveNumber(
  value: unknown,
  maximum: number,
): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= maximum
    ? value
    : undefined;
}

function hashCandidate(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `candidate-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function safeDisplayName(
  url: URL,
  sourceType: VideoCandidate["sourceType"],
): string {
  if (sourceType !== "direct") {
    const labels: Record<UnsupportedSourceType, string> = {
      blob: "Page-managed video stream",
      dash: "DASH stream",
      hls: "HLS stream",
      "media-stream": "Live media stream",
    };
    return labels[sourceType];
  }

  const rawName = decodePathPart(url.pathname.split("/").at(-1) ?? "");
  const name = cleanText(rawName.replace(/[\\/]+/g, " "), 120).replace(
    /^\.+/,
    "",
  );
  return name || `Video from ${url.hostname}`;
}

function richerNumber(
  current: number | undefined,
  incoming: number | undefined,
): number | undefined {
  return current ?? incoming;
}

function mergeCandidate(
  existing: CandidateWithOrder,
  incoming: CandidateWithOrder,
): CandidateWithOrder {
  const safest =
    existing.support.status === "downloadable" &&
    incoming.support.status === "unsupported"
      ? incoming
      : existing;
  return {
    ...safest,
    order: existing.order,
    duration: richerNumber(existing.duration, incoming.duration),
    height: richerNumber(existing.height, incoming.height),
    width: richerNumber(existing.width, incoming.width),
  };
}

function candidateArea(candidate: VideoCandidate): number {
  return (candidate.width ?? 0) * (candidate.height ?? 0);
}

function uniqueId(baseId: string, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }
  let suffix = 2;
  while (usedIds.has(`${baseId}-${suffix}`)) suffix += 1;
  const id = `${baseId}-${suffix}`;
  usedIds.add(id);
  return id;
}

function validateCandidate(
  raw: unknown,
  order: number,
): CandidateWithOrder | null {
  if (!isRecord(raw) || !isSourceKind(raw.sourceKind)) return null;
  if (
    typeof raw.url !== "string" ||
    raw.url.length === 0 ||
    raw.url.length > MAX_URL_LENGTH
  ) {
    return null;
  }

  const mediaType = safeString(raw.mediaType, MAX_MEDIA_TYPE_LENGTH);
  const classification = classifyVideoSource(
    raw.url,
    mediaType,
    raw.sourceKind,
  );
  if (!classification) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(raw.url);
  } catch {
    return null;
  }
  if (parsedUrl.username || parsedUrl.password) return null;

  const normalizedUrl = parsedUrl.toString();
  const dimensions = {
    width: safePositiveNumber(raw.width, MAX_DIMENSION),
    height: safePositiveNumber(raw.height, MAX_DIMENSION),
    duration: safePositiveNumber(raw.duration, MAX_DURATION_SECONDS),
  };

  return {
    id: hashCandidate(`${classification.sourceType}:${normalizedUrl}`),
    url: normalizedUrl,
    displayName: safeDisplayName(parsedUrl, classification.sourceType),
    hostname:
      parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:"
        ? parsedUrl.hostname
        : "Current page",
    format: classification.format,
    sourceType: classification.sourceType,
    support:
      classification.status === "downloadable"
        ? { status: "downloadable" }
        : { reason: classification.sourceType, status: "unsupported" },
    order,
    ...(dimensions.width === undefined ? {} : { width: dimensions.width }),
    ...(dimensions.height === undefined ? {} : { height: dimensions.height }),
    ...(dimensions.duration === undefined
      ? {}
      : { duration: dimensions.duration }),
  };
}

export function validateCollectedVideos(input: unknown): ValidatedCollection {
  if (!isRecord(input) || !Array.isArray(input.candidates)) {
    return {
      candidates: [],
      pageTitle: "Current page",
      pageUrl: "",
    };
  }

  const pageTitle =
    safeString(input.pageTitle, MAX_TITLE_LENGTH) || "Current page";
  const pageUrl = safeString(input.pageUrl, 4_096);
  const byUrl = new Map<string, CandidateWithOrder>();

  for (const [index, rawCandidate] of input.candidates
    .slice(0, MAX_RAW_CANDIDATES)
    .entries()) {
    const candidate = validateCandidate(rawCandidate, index);
    if (!candidate) continue;
    const existing = byUrl.get(candidate.url);
    byUrl.set(
      candidate.url,
      existing ? mergeCandidate(existing, candidate) : candidate,
    );
    if (byUrl.size >= MAX_CANDIDATES) break;
  }

  const usedIds = new Set<string>();
  const candidates = [...byUrl.values()]
    .sort((left, right) => {
      const supportOrder =
        Number(right.support.status === "downloadable") -
        Number(left.support.status === "downloadable");
      return (
        supportOrder ||
        candidateArea(right) - candidateArea(left) ||
        left.order - right.order
      );
    })
    .map(({ order: _order, ...candidate }) => ({
      ...candidate,
      id: uniqueId(candidate.id, usedIds),
    }));

  return { candidates, pageTitle, pageUrl };
}
