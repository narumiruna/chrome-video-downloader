import {
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
import {
  capturedMp4TrackKind,
  embeddedMp4Initializations,
  isCapturedMp4PlaylistMetadata,
} from "./captured-mp4-metadata";

const MAX_REQUESTS = 2_000;
const MAX_PART_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

export interface CapturedMediaRequest {
  url: string;
  mimeType: string;
  timestamp: number;
  range?: string;
}

export interface AssemblyProgress {
  phase: "fetching" | "muxing";
  completed: number;
  total: number;
}

export interface AssembleCapturedMp4Options {
  fetchPart?: (request: CapturedMediaRequest) => Promise<ArrayBuffer>;
  onProgress?: (progress: AssemblyProgress) => void;
}

type TrackKind = "audio" | "video";

interface FetchedPart {
  bytes: ArrayBuffer;
  decodeTime: bigint | null;
  hasInitialization: boolean;
  hasMediaFragment: boolean;
  request: CapturedMediaRequest;
}

function requestKey(request: CapturedMediaRequest): string {
  return `${request.url}\n${request.range ?? ""}`;
}

function readUint32(data: DataView, offset: number): number {
  return data.getUint32(offset, false);
}

function readUint64(data: DataView, offset: number): bigint {
  return (
    (BigInt(readUint32(data, offset)) << 32n) |
    BigInt(readUint32(data, offset + 4))
  );
}

function ascii(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset] ?? 0,
    data[offset + 1] ?? 0,
    data[offset + 2] ?? 0,
    data[offset + 3] ?? 0,
  );
}

function topLevelBoxTypes(bytes: ArrayBuffer): Set<string> {
  const data = new Uint8Array(bytes);
  const view = new DataView(bytes);
  const types = new Set<string>();
  let offset = 0;

  while (offset + 8 <= data.length) {
    let size = readUint32(view, offset);
    const type = ascii(data, offset + 4);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > data.length) break;
      const largeSize = readUint64(view, offset + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(largeSize);
      headerSize = 16;
    } else if (size === 0) {
      size = data.length - offset;
    }

    if (size < headerSize || offset + size > data.length) break;
    types.add(type);
    offset += size;
  }

  return types;
}

function decodeTime(bytes: ArrayBuffer): bigint | null {
  const data = new Uint8Array(bytes);
  const view = new DataView(bytes);

  for (let typeOffset = 4; typeOffset + 12 <= data.length; typeOffset += 1) {
    if (ascii(data, typeOffset) !== "tfdt") continue;

    const boxOffset = typeOffset - 4;
    const size = readUint32(view, boxOffset);
    if (size < 16 || boxOffset + size > data.length) continue;

    const version = data[typeOffset + 4];
    if (version === 1 && typeOffset + 16 <= data.length) {
      return readUint64(view, typeOffset + 8);
    }
    if (version === 0 && typeOffset + 12 <= data.length) {
      return BigInt(readUint32(view, typeOffset + 8));
    }
  }

  return null;
}

async function defaultFetchPart(
  request: CapturedMediaRequest,
): Promise<ArrayBuffer> {
  const response = await fetch(request.url, {
    credentials: "include",
    headers: request.range ? { Range: request.range } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Media request failed with status ${response.status}.`);
  }
  return response.arrayBuffer();
}

async function fetchParts(
  requests: CapturedMediaRequest[],
  options: AssembleCapturedMp4Options,
): Promise<Map<TrackKind, FetchedPart[]>> {
  const uniqueRequests = [
    ...new Map(
      requests.map((request) => [requestKey(request), request]),
    ).values(),
  ].filter(
    (request) =>
      capturedMp4TrackKind(request) !== null ||
      isCapturedMp4PlaylistMetadata(request),
  );
  const mediaRequests = uniqueRequests.filter(
    (request) => capturedMp4TrackKind(request) !== null,
  );

  if (mediaRequests.length === 0) {
    throw new Error("No MP4 stream parts were captured.");
  }
  if (uniqueRequests.length > MAX_REQUESTS) {
    throw new Error("Too many stream parts were captured.");
  }

  const byKind = new Map<TrackKind, FetchedPart[]>([
    ["audio", []],
    ["video", []],
  ]);
  const fetchPart = options.fetchPart ?? defaultFetchPart;
  const metadata: Array<{
    bytes: ArrayBuffer;
    request: CapturedMediaRequest;
  }> = [];
  let totalBytes = 0;

  for (const [index, request] of uniqueRequests.entries()) {
    const bytes = await fetchPart(request);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PART_BYTES) {
      throw new Error("A captured stream part has an invalid size.");
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(
        "The captured stream is too large to assemble in memory.",
      );
    }

    const kind = capturedMp4TrackKind(request);
    if (kind) {
      const types = topLevelBoxTypes(bytes);
      byKind.get(kind)?.push({
        bytes,
        decodeTime: decodeTime(bytes),
        hasInitialization: types.has("ftyp") && types.has("moov"),
        hasMediaFragment: types.has("moof"),
        request,
      });
    } else {
      metadata.push({ bytes, request });
    }
    options.onProgress?.({
      phase: "fetching",
      completed: index + 1,
      total: uniqueRequests.length,
    });
  }

  for (const item of metadata) {
    for (const initialization of embeddedMp4Initializations(
      item.bytes,
      item.request.url,
      mediaRequests,
    )) {
      const parts = byKind.get(initialization.kind) as FetchedPart[];
      if (parts.some((part) => part.hasInitialization)) continue;
      const types = topLevelBoxTypes(initialization.bytes);
      if (!types.has("ftyp") || !types.has("moov")) continue;
      parts.push({
        bytes: initialization.bytes,
        decodeTime: null,
        hasInitialization: true,
        hasMediaFragment: false,
        request: item.request,
      });
    }
  }

  return byKind;
}

function createTrackInput(parts: FetchedPart[], kind: TrackKind): Input {
  const initialization = parts
    .filter((part) => part.hasInitialization)
    .sort((left, right) => left.request.timestamp - right.request.timestamp)[0];
  if (!initialization) {
    throw new Error(
      `The ${kind} initialization segment was not captured. Replay from the beginning and try again.`,
    );
  }

  const fragments = parts
    .filter(
      (part): part is FetchedPart & { decodeTime: bigint } =>
        part.hasMediaFragment && part.decodeTime !== null,
    )
    .sort((left, right) =>
      left.decodeTime < right.decodeTime
        ? -1
        : left.decodeTime > right.decodeTime
          ? 1
          : left.request.timestamp - right.request.timestamp,
    );

  const uniqueFragments = [
    ...new Map(
      fragments.map((part) => [part.decodeTime.toString(), part]),
    ).values(),
  ];

  if (uniqueFragments.length === 0) {
    return new Input({
      formats: [MP4],
      source: new BlobSource(new Blob([initialization.bytes])),
    });
  }

  const initInput = new Input({
    formats: [MP4],
    source: new BlobSource(new Blob([initialization.bytes])),
  });
  return new Input({
    formats: [MP4],
    initInput,
    source: new BlobSource(new Blob(uniqueFragments.map((part) => part.bytes))),
  });
}

export async function assembleCapturedMp4(
  requests: CapturedMediaRequest[],
  options: AssembleCapturedMp4Options = {},
): Promise<Blob> {
  const parts = await fetchParts(requests, options);
  const videoParts = parts.get("video") ?? [];
  const audioParts = parts.get("audio") ?? [];
  if (videoParts.length === 0) {
    throw new Error("No video track was captured.");
  }

  const videoInput = createTrackInput(videoParts, "video");
  const audioInput =
    audioParts.length > 0 ? createTrackInput(audioParts, "audio") : null;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });

  try {
    const conversions = [
      await Conversion.init({
        input: videoInput,
        output,
        composable: true,
        audio: { discard: true },
      }),
    ];
    if (audioInput) {
      conversions.push(
        await Conversion.init({
          input: audioInput,
          output,
          composable: true,
          video: { discard: true },
        }),
      );
    }
    if (conversions.some((conversion) => !conversion.isValid)) {
      throw new Error(
        "The captured audio and video tracks cannot be combined.",
      );
    }

    options.onProgress?.({ phase: "muxing", completed: 0, total: 1 });
    await output.start();
    await Promise.all(conversions.map((conversion) => conversion.execute()));
    await output.finalize();
    options.onProgress?.({ phase: "muxing", completed: 1, total: 1 });

    if (!target.buffer || target.buffer.byteLength === 0) {
      throw new Error("The assembled MP4 is empty.");
    }
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    videoInput.dispose();
    audioInput?.dispose();
  }
}
