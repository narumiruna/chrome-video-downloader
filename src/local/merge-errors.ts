export type SegmentMergeErrorCode =
  | "ambiguous-input"
  | "encrypted-input"
  | "invalid-input"
  | "live-input"
  | "master-playlist"
  | "merge-failed"
  | "missing-input"
  | "output-exists"
  | "path-escape"
  | "remote-input"
  | "verification-failed";

export class SegmentMergeError extends Error {
  constructor(
    public readonly code: SegmentMergeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SegmentMergeError";
  }
}
