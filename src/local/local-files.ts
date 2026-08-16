import { open, readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve, sep } from "node:path";
import { SegmentMergeError } from "./merge-errors";

export const MAX_LOCAL_REFERENCES = 10_000;
export const MAX_MANIFEST_BYTES = 1_048_576;
export const MAX_REFERENCE_LENGTH = 8_192;

export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    if (code <= 31 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

export function isFilesystemPath(path: string): boolean {
  if (
    path.length === 0 ||
    hasControlCharacters(path) ||
    /^[\\/]{2}/.test(path)
  ) {
    return false;
  }
  return !/^[a-z][a-z\d+.-]*:/i.test(path) || /^[a-z]:[\\/]/i.test(path);
}

export function isInside(directory: string, path: string): boolean {
  return path.startsWith(`${directory}${sep}`);
}

export async function requireRegularFile(
  path: string,
  missingMessage: string,
): Promise<string> {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(path);
    const file = await stat(canonicalPath);
    if (!file.isFile()) {
      throw new SegmentMergeError(
        "invalid-input",
        `${path} is not a regular file.`,
      );
    }
  } catch (error) {
    if (error instanceof SegmentMergeError) throw error;
    throw new SegmentMergeError("missing-input", missingMessage);
  }
  return canonicalPath;
}

export async function readBoundedLocalFile(
  path: string,
  label: string,
): Promise<{ content: string; path: string; root: string }> {
  if (!isFilesystemPath(path)) {
    throw new SegmentMergeError(
      "remote-input",
      `${label} must be a local filesystem path.`,
    );
  }
  const canonicalPath = await requireRegularFile(
    resolve(path),
    `${label} not found: ${path}`,
  );
  const file = await stat(canonicalPath);
  if (file.size > MAX_MANIFEST_BYTES) {
    throw new SegmentMergeError("invalid-input", `${label} is too large.`);
  }
  const buffer = await readFile(canonicalPath);
  if (buffer.byteLength > MAX_MANIFEST_BYTES) {
    throw new SegmentMergeError("invalid-input", `${label} is too large.`);
  }
  return {
    content: buffer.toString("utf8"),
    path: canonicalPath,
    root: await realpath(dirname(canonicalPath)),
  };
}

function decodeReference(reference: string): string {
  if (
    reference.length === 0 ||
    reference.length > MAX_REFERENCE_LENGTH ||
    hasControlCharacters(reference)
  ) {
    throw new SegmentMergeError(
      "invalid-input",
      "A manifest contains an invalid local media reference.",
    );
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(reference);
  } catch {
    throw new SegmentMergeError(
      "invalid-input",
      "A manifest contains a malformed local media reference.",
    );
  }
  if (
    hasControlCharacters(decoded) ||
    isAbsolute(decoded) ||
    /^[\\/]{2}/.test(decoded) ||
    /^[a-z][a-z\d+.-]*:/i.test(decoded) ||
    decoded.includes("?") ||
    decoded.includes("#") ||
    decoded.includes("\\")
  ) {
    throw new SegmentMergeError(
      "remote-input",
      "Manifest media references must be relative local paths.",
    );
  }
  return decoded;
}

export async function rejectEncryptedInitializationFile(
  path: string,
): Promise<void> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_MANIFEST_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    const encrypted =
      extname(path).toLowerCase() === ".webm"
        ? [
            Buffer.from([0x6d, 0x80]),
            Buffer.from([0x50, 0x35]),
            Buffer.from([0x47, 0xe1]),
          ].some((marker) => header.includes(marker))
        : ["pssh", "sinf", "schm", "tenc"].some((marker) =>
            header.includes(Buffer.from(marker, "ascii")),
          );
    if (encrypted) {
      throw new SegmentMergeError(
        "encrypted-input",
        "Encrypted fragmented-media initialization files are not supported.",
      );
    }
  } finally {
    await file.close();
  }
}

export async function rejectManifestLikeFile(path: string): Promise<void> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(4_096);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const header = buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .trimStart();
    if (
      header.startsWith("#EXTM3U") ||
      header.startsWith("ffconcat version") ||
      /^\{\s*"version"\s*:/i.test(header) ||
      /^(?:<\?xml[^>]*>\s*)?<MPD[\s>]/i.test(header)
    ) {
      throw new SegmentMergeError(
        "invalid-input",
        "Nested media playlists and concat manifests are not accepted as media files.",
      );
    }
  } finally {
    await file.close();
  }
}

export async function resolveLocalReference(
  root: string,
  reference: string,
): Promise<string> {
  const candidatePath = resolve(root, decodeReference(reference));
  if (!isInside(root, candidatePath)) {
    throw new SegmentMergeError(
      "path-escape",
      "A manifest reference escapes the manifest directory.",
    );
  }
  const canonicalPath = await requireRegularFile(
    candidatePath,
    `Referenced media file not found: ${reference}`,
  );
  if (!isInside(root, canonicalPath)) {
    throw new SegmentMergeError(
      "path-escape",
      "A manifest reference escapes through a symlink.",
    );
  }
  return canonicalPath;
}
