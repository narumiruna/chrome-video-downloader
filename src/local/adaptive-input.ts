import { extname } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  MAX_LOCAL_REFERENCES,
  readBoundedLocalFile,
  rejectEncryptedInitializationFile,
  rejectManifestLikeFile,
  resolveLocalReference,
} from "./local-files";
import { SegmentMergeError } from "./merge-errors";

export type AdaptiveTrackKind = "audio" | "video";

export interface ValidatedAdaptiveTrack {
  initPath: string;
  kind: AdaptiveTrackKind;
  segmentPaths: string[];
  temporaryExtension: ".mp4" | ".webm";
}

export interface ValidatedAdaptiveInput {
  manifestPath: string;
  tracks: ValidatedAdaptiveTrack[];
}

export interface DashRepresentationSelection {
  audioRepresentation?: string;
  videoRepresentation?: string;
}

type XmlNode = Record<string, unknown>;

function isObject(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: XmlNode, allowed: string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

async function mediaReference(
  root: string,
  reference: string,
): Promise<string> {
  const path = await resolveLocalReference(root, reference);
  await rejectManifestLikeFile(path);
  return path;
}

function temporaryExtension(path: string): ".mp4" | ".webm" {
  const extension = extname(path).toLowerCase();
  if (extension === ".webm") return ".webm";
  if ([".cmfa", ".cmfv", ".m4s", ".mp4"].includes(extension)) return ".mp4";
  throw new SegmentMergeError(
    "invalid-input",
    "Adaptive track files must use fragmented MP4 or WebM extensions.",
  );
}

async function validatedTrack(
  root: string,
  kind: AdaptiveTrackKind,
  value: unknown,
): Promise<ValidatedAdaptiveTrack> {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["init", "segments"]) ||
    typeof value.init !== "string" ||
    !Array.isArray(value.segments) ||
    value.segments.length === 0 ||
    value.segments.length > MAX_LOCAL_REFERENCES ||
    !value.segments.every((segment) => typeof segment === "string")
  ) {
    throw new SegmentMergeError(
      "invalid-input",
      `The ${kind} track must contain one init path and ordered segment paths.`,
    );
  }
  const initPath = await mediaReference(root, value.init);
  await rejectEncryptedInitializationFile(initPath);
  const extension = temporaryExtension(initPath);
  const segmentPaths: string[] = [];
  for (const segment of value.segments as string[]) {
    const segmentPath = await mediaReference(root, segment);
    if (temporaryExtension(segmentPath) !== extension) {
      throw new SegmentMergeError(
        "invalid-input",
        `The ${kind} track mixes fragmented MP4 and WebM files.`,
      );
    }
    segmentPaths.push(segmentPath);
  }
  return { initPath, kind, segmentPaths, temporaryExtension: extension };
}

export async function validateLocalTrackManifest(
  manifestPath: string,
): Promise<ValidatedAdaptiveInput> {
  const manifest = await readBoundedLocalFile(manifestPath, "Track manifest");
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest.content);
  } catch {
    throw new SegmentMergeError(
      "invalid-input",
      "The track manifest is not valid JSON.",
    );
  }
  if (
    !isObject(parsed) ||
    !hasOnlyKeys(parsed, ["version", "video", "audio"]) ||
    parsed.version !== 1 ||
    (!Object.hasOwn(parsed, "video") && !Object.hasOwn(parsed, "audio")) ||
    (Object.hasOwn(parsed, "video") && !isObject(parsed.video)) ||
    (Object.hasOwn(parsed, "audio") && !isObject(parsed.audio))
  ) {
    throw new SegmentMergeError(
      "invalid-input",
      "The track manifest must use version 1 and contain video or audio.",
    );
  }

  const tracks: ValidatedAdaptiveTrack[] = [];
  if (Object.hasOwn(parsed, "video")) {
    tracks.push(await validatedTrack(manifest.root, "video", parsed.video));
  }
  if (Object.hasOwn(parsed, "audio")) {
    tracks.push(await validatedTrack(manifest.root, "audio", parsed.audio));
  }
  const referenceCount = tracks.reduce(
    (count, track) => count + 1 + track.segmentPaths.length,
    0,
  );
  if (referenceCount > MAX_LOCAL_REFERENCES) {
    throw new SegmentMergeError(
      "invalid-input",
      "The track manifest contains too many media references.",
    );
  }
  return { manifestPath: manifest.path, tracks };
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function containsKey(value: unknown, keys: Set<string>): boolean {
  if (Array.isArray(value))
    return value.some((item) => containsKey(item, keys));
  if (!isObject(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => keys.has(key) || containsKey(child, keys),
  );
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192) {
    throw new SegmentMergeError("invalid-input", `${label} is invalid.`);
  }
  return value;
}

function safeInteger(value: unknown, label: string, minimum: number): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new SegmentMergeError("invalid-input", `${label} is invalid.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new SegmentMergeError("invalid-input", `${label} is invalid.`);
  }
  return parsed;
}

interface TimelinePoint {
  number: number;
  time: number;
}

function timelinePoints(template: XmlNode): TimelinePoint[] {
  const timeline = template.SegmentTimeline;
  if (!isObject(timeline)) {
    throw new SegmentMergeError(
      "invalid-input",
      "DASH SegmentTemplate requires a finite SegmentTimeline.",
    );
  }
  const entries = asArray(timeline.S);
  if (entries.length === 0 || entries.length > MAX_LOCAL_REFERENCES) {
    throw new SegmentMergeError(
      "invalid-input",
      "DASH SegmentTimeline has no entries or too many entries.",
    );
  }
  let number =
    template["@_startNumber"] === undefined
      ? 1
      : safeInteger(template["@_startNumber"], "DASH startNumber", 0);
  let time = 0;
  const points: TimelinePoint[] = [];
  for (const entry of entries) {
    if (!isObject(entry)) {
      throw new SegmentMergeError(
        "invalid-input",
        "DASH SegmentTimeline contains an invalid entry.",
      );
    }
    const duration = safeInteger(entry["@_d"], "DASH segment duration", 1);
    if (entry["@_t"] !== undefined) {
      time = safeInteger(entry["@_t"], "DASH segment time", 0);
    }
    const repeat =
      entry["@_r"] === undefined
        ? 0
        : safeInteger(entry["@_r"], "DASH segment repeat", 0);
    if (points.length + repeat + 1 > MAX_LOCAL_REFERENCES) {
      throw new SegmentMergeError(
        "invalid-input",
        "DASH SegmentTimeline expands to too many segments.",
      );
    }
    for (let index = 0; index <= repeat; index += 1) {
      points.push({ number, time });
      number += 1;
      time += duration;
      if (!Number.isSafeInteger(number) || !Number.isSafeInteger(time)) {
        throw new SegmentMergeError(
          "invalid-input",
          "DASH SegmentTimeline exceeds safe numeric limits.",
        );
      }
    }
  }
  return points;
}

function expandTemplate(
  template: string,
  variables: {
    number?: number;
    representationId: string;
    time?: number;
  },
): string {
  let invalid = false;
  const expanded = template.replace(/\$([^$]+)\$/g, (_match, token: string) => {
    if (token === "RepresentationID") return variables.representationId;
    if (token === "Time" && variables.time !== undefined) {
      return String(variables.time);
    }
    if (token === "Number" && variables.number !== undefined) {
      return String(variables.number);
    }
    const padded = /^Number%0([1-9]|1\d|20)d$/.exec(token);
    if (padded && variables.number !== undefined) {
      return String(variables.number).padStart(Number(padded[1]), "0");
    }
    invalid = true;
    return "";
  });
  if (invalid || expanded.includes("$")) {
    throw new SegmentMergeError(
      "invalid-input",
      "DASH contains an unsupported template token.",
    );
  }
  return expanded;
}

function representationKind(
  adaptation: XmlNode,
  representation: XmlNode,
): AdaptiveTrackKind | null {
  const contentType =
    representation["@_contentType"] ?? adaptation["@_contentType"];
  const mimeType = representation["@_mimeType"] ?? adaptation["@_mimeType"];
  if (
    contentType === "video" ||
    (typeof mimeType === "string" && mimeType.startsWith("video/"))
  ) {
    return "video";
  }
  if (
    contentType === "audio" ||
    (typeof mimeType === "string" && mimeType.startsWith("audio/"))
  ) {
    return "audio";
  }
  return null;
}

interface DashRepresentation {
  adaptation: XmlNode;
  id: string;
  kind: AdaptiveTrackKind;
  representation: XmlNode;
}

function chooseRepresentation(
  representations: DashRepresentation[],
  kind: AdaptiveTrackKind,
  selectedId: string | undefined,
): DashRepresentation {
  const candidates = representations.filter((item) => item.kind === kind);
  if (candidates.length === 0) {
    throw new SegmentMergeError(
      "invalid-input",
      `The DASH manifest has no supported ${kind} representation.`,
    );
  }
  if (selectedId !== undefined) {
    const selected = candidates.filter((item) => item.id === selectedId);
    if (selected.length !== 1) {
      throw new SegmentMergeError(
        "invalid-input",
        `The requested DASH ${kind} representation was not found or is duplicated.`,
      );
    }
    return selected[0] as DashRepresentation;
  }
  if (candidates.length !== 1) {
    throw new SegmentMergeError(
      "ambiguous-input",
      `Choose one DASH ${kind} representation explicitly.`,
    );
  }
  return candidates[0] as DashRepresentation;
}

async function trackFromSegmentList(
  root: string,
  selected: DashRepresentation,
  list: XmlNode,
): Promise<ValidatedAdaptiveTrack> {
  const initialization = list.Initialization;
  const segments = asArray(list.SegmentURL);
  if (
    !isObject(initialization) ||
    segments.length === 0 ||
    segments.length > MAX_LOCAL_REFERENCES ||
    containsKey(
      list,
      new Set(["@_range", "@_mediaRange", "@_indexRange", "@_index"]),
    )
  ) {
    throw new SegmentMergeError(
      "invalid-input",
      "DASH SegmentList is missing local files or uses byte ranges.",
    );
  }
  const initReference = requiredString(
    initialization["@_sourceURL"],
    "DASH initialization reference",
  );
  const initPath = await mediaReference(root, initReference);
  await rejectEncryptedInitializationFile(initPath);
  const extension = temporaryExtension(initPath);
  const segmentPaths: string[] = [];
  for (const segment of segments) {
    if (!isObject(segment)) {
      throw new SegmentMergeError(
        "invalid-input",
        "DASH SegmentList contains an invalid segment.",
      );
    }
    const path = await mediaReference(
      root,
      requiredString(segment["@_media"], "DASH segment reference"),
    );
    if (temporaryExtension(path) !== extension) {
      throw new SegmentMergeError(
        "invalid-input",
        "A DASH track mixes fragmented MP4 and WebM files.",
      );
    }
    segmentPaths.push(path);
  }
  return {
    initPath,
    kind: selected.kind,
    segmentPaths,
    temporaryExtension: extension,
  };
}

async function trackFromSegmentTemplate(
  root: string,
  selected: DashRepresentation,
  template: XmlNode,
): Promise<ValidatedAdaptiveTrack> {
  const initialization = requiredString(
    template["@_initialization"],
    "DASH initialization template",
  );
  const media = requiredString(template["@_media"], "DASH media template");
  if (template["@_timescale"] !== undefined) {
    safeInteger(template["@_timescale"], "DASH timescale", 1);
  }
  const points = timelinePoints(template);
  const initPath = await mediaReference(
    root,
    expandTemplate(initialization, { representationId: selected.id }),
  );
  await rejectEncryptedInitializationFile(initPath);
  const extension = temporaryExtension(initPath);
  const segmentPaths: string[] = [];
  for (const point of points) {
    const path = await mediaReference(
      root,
      expandTemplate(media, {
        number: point.number,
        representationId: selected.id,
        time: point.time,
      }),
    );
    if (temporaryExtension(path) !== extension) {
      throw new SegmentMergeError(
        "invalid-input",
        "A DASH track mixes fragmented MP4 and WebM files.",
      );
    }
    segmentPaths.push(path);
  }
  return {
    initPath,
    kind: selected.kind,
    segmentPaths,
    temporaryExtension: extension,
  };
}

async function validatedDashTrack(
  root: string,
  selected: DashRepresentation,
): Promise<ValidatedAdaptiveTrack> {
  if (
    selected.adaptation.SegmentList !== undefined ||
    selected.adaptation.SegmentTemplate !== undefined
  ) {
    throw new SegmentMergeError(
      "invalid-input",
      "Inherited DASH segment descriptions are not supported.",
    );
  }
  const list = selected.representation.SegmentList;
  const template = selected.representation.SegmentTemplate;
  if (Boolean(list) === Boolean(template)) {
    throw new SegmentMergeError(
      "invalid-input",
      "A DASH representation must contain one supported segment description.",
    );
  }
  if (isObject(list)) return trackFromSegmentList(root, selected, list);
  if (isObject(template))
    return trackFromSegmentTemplate(root, selected, template);
  throw new SegmentMergeError(
    "invalid-input",
    "A DASH segment description is invalid.",
  );
}

export async function validateLocalDashManifest(
  manifestPath: string,
  selection: DashRepresentationSelection,
): Promise<ValidatedAdaptiveInput> {
  const manifest = await readBoundedLocalFile(manifestPath, "DASH manifest");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(manifest.content)) {
    throw new SegmentMergeError(
      "invalid-input",
      "DASH DTD and entity declarations are not supported.",
    );
  }
  if (/\bxlink:href\s*=/i.test(manifest.content)) {
    throw new SegmentMergeError(
      "remote-input",
      "DASH XLink references are not supported.",
    );
  }
  let validation: unknown;
  try {
    validation = XMLValidator.validate(manifest.content);
  } catch {
    validation = false;
  }
  if (validation !== true) {
    throw new SegmentMergeError(
      "invalid-input",
      "The DASH manifest is not valid XML.",
    );
  }

  let parsed: unknown;
  try {
    parsed = new XMLParser({
      attributeNamePrefix: "@_",
      ignoreAttributes: false,
      parseAttributeValue: false,
      parseTagValue: false,
      processEntities: false,
      removeNSPrefix: true,
      trimValues: true,
    }).parse(manifest.content);
  } catch {
    throw new SegmentMergeError(
      "invalid-input",
      "The DASH manifest could not be parsed.",
    );
  }
  if (!isObject(parsed) || !isObject(parsed.MPD)) {
    throw new SegmentMergeError(
      "invalid-input",
      "The input is not a DASH MPD.",
    );
  }
  const mpd = parsed.MPD;
  if (mpd["@_type"] !== "static") {
    throw new SegmentMergeError(
      "live-input",
      "Only static DASH presentations are supported.",
    );
  }
  if (containsKey(mpd, new Set(["ContentProtection"]))) {
    throw new SegmentMergeError(
      "encrypted-input",
      "DASH ContentProtection is not supported.",
    );
  }
  if (containsKey(mpd, new Set(["Location", "UTCTiming"]))) {
    throw new SegmentMergeError(
      "remote-input",
      "External DASH references are not supported.",
    );
  }
  if (containsKey(mpd, new Set(["BaseURL", "SegmentBase"]))) {
    throw new SegmentMergeError(
      "invalid-input",
      "DASH BaseURL and SegmentBase are not supported.",
    );
  }

  const periods = asArray(mpd.Period);
  if (periods.length !== 1 || !isObject(periods[0])) {
    throw new SegmentMergeError(
      "invalid-input",
      "The DASH manifest must contain exactly one Period.",
    );
  }
  const period = periods[0];
  if (
    mpd.SegmentList !== undefined ||
    mpd.SegmentTemplate !== undefined ||
    period.SegmentList !== undefined ||
    period.SegmentTemplate !== undefined
  ) {
    throw new SegmentMergeError(
      "invalid-input",
      "MPD and Period segment inheritance are not supported.",
    );
  }
  const adaptations = asArray(period.AdaptationSet);
  const representations: DashRepresentation[] = [];
  for (const adaptation of adaptations) {
    if (!isObject(adaptation)) continue;
    for (const representation of asArray(adaptation.Representation)) {
      if (!isObject(representation)) continue;
      const kind = representationKind(adaptation, representation);
      if (!kind) continue;
      const id = requiredString(
        representation["@_id"],
        "DASH representation ID",
      );
      if (id.length > 256) {
        throw new SegmentMergeError(
          "invalid-input",
          "DASH representation ID is too long.",
        );
      }
      representations.push({ adaptation, id, kind, representation });
    }
  }

  const selectedVideo = chooseRepresentation(
    representations,
    "video",
    selection.videoRepresentation,
  );
  const selectedAudio = chooseRepresentation(
    representations,
    "audio",
    selection.audioRepresentation,
  );
  const tracks = [
    await validatedDashTrack(manifest.root, selectedVideo),
    await validatedDashTrack(manifest.root, selectedAudio),
  ];
  if (
    tracks.reduce((count, track) => count + 1 + track.segmentPaths.length, 0) >
    MAX_LOCAL_REFERENCES
  ) {
    throw new SegmentMergeError(
      "invalid-input",
      "The DASH manifest references too many media files.",
    );
  }
  return { manifestPath: manifest.path, tracks };
}
