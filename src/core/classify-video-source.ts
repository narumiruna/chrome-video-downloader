export type RawSourceKind =
  | "media-element"
  | "source-element"
  | "performance"
  | "media-stream";

export type UnsupportedSourceType = "blob" | "hls" | "dash" | "media-stream";

export type SourceClassification =
  | {
      format: string;
      sourceType: "direct";
      status: "downloadable";
    }
  | {
      format: string;
      sourceType: UnsupportedSourceType;
      status: "unsupported";
    };

const DIRECT_EXTENSIONS = new Map([
  ["mp4", "MP4"],
  ["m4v", "M4V"],
  ["mov", "MOV"],
  ["ogv", "OGV"],
  ["webm", "WEBM"],
]);
const SEGMENT_EXTENSIONS = new Set(["aac", "m4s", "ts"]);
const HLS_MEDIA_TYPES = new Set([
  "application/mpegurl",
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
]);

function extensionFromUrl(url: URL): string {
  const filename = url.pathname.split("/").at(-1) ?? "";
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

function normalizedMediaType(mediaType: string): string {
  return mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function formatFromMediaType(mediaType: string): string {
  const subtype = mediaType.split("/", 2)[1] ?? "";
  const normalized = subtype.split("+", 1)[0]?.replace(/^x-/, "") ?? "";
  return normalized ? normalized.toUpperCase() : "VIDEO";
}

export function classifyVideoSource(
  rawUrl: string,
  rawMediaType: string,
  sourceKind: RawSourceKind,
): SourceClassification | null {
  if (sourceKind === "media-stream" || rawUrl === "mediastream:") {
    return {
      format: "LIVE",
      sourceType: "media-stream",
      status: "unsupported",
    };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const mediaType = normalizedMediaType(rawMediaType);
  if (url.protocol === "blob:") {
    return {
      format: "BLOB",
      sourceType: "blob",
      status: "unsupported",
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const extension = extensionFromUrl(url);
  if (extension === "m3u8" || HLS_MEDIA_TYPES.has(mediaType)) {
    return {
      format: "HLS",
      sourceType: "hls",
      status: "unsupported",
    };
  }
  if (extension === "mpd" || mediaType === "application/dash+xml") {
    return {
      format: "DASH",
      sourceType: "dash",
      status: "unsupported",
    };
  }
  if (SEGMENT_EXTENSIONS.has(extension)) return null;

  const extensionFormat = DIRECT_EXTENSIONS.get(extension);
  if (extensionFormat) {
    return {
      format: extensionFormat,
      sourceType: "direct",
      status: "downloadable",
    };
  }
  if (mediaType.startsWith("video/")) {
    return {
      format: formatFromMediaType(mediaType),
      sourceType: "direct",
      status: "downloadable",
    };
  }
  if (sourceKind === "media-element" || sourceKind === "source-element") {
    return {
      format: "VIDEO",
      sourceType: "direct",
      status: "downloadable",
    };
  }
  return null;
}
