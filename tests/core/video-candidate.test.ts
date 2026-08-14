import { describe, expect, test } from "vitest";
import { validateCollectedVideos } from "../../src/core/video-candidate";

const page = {
  pageTitle: "Training / Demo",
  pageUrl: "https://example.com/watch",
};

describe("validateCollectedVideos", () => {
  test("validates, deduplicates, and sorts downloadable videos first", () => {
    const result = validateCollectedVideos({
      ...page,
      candidates: [
        {
          url: "blob:https://example.com/blob-id",
          sourceKind: "media-element",
          mediaType: "video/mp4",
        },
        {
          url: "https://cdn.example.com/movie.mp4?token=top-secret",
          sourceKind: "source-element",
          mediaType: "video/mp4",
        },
        {
          url: "https://cdn.example.com/movie.mp4?token=top-secret",
          sourceKind: "media-element",
          mediaType: "video/mp4",
          width: 1920,
          height: 1080,
          duration: 61.25,
        },
      ],
    });

    expect(result.pageTitle).toBe("Training / Demo");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toMatchObject({
      url: "https://cdn.example.com/movie.mp4?token=top-secret",
      displayName: "movie.mp4",
      hostname: "cdn.example.com",
      format: "MP4",
      width: 1920,
      height: 1080,
      duration: 61.25,
      support: { status: "downloadable" },
    });
    expect(result.candidates[0]?.displayName).not.toContain("top-secret");
    expect(result.candidates[1]?.support).toEqual({
      reason: "blob",
      status: "unsupported",
    });
  });

  test("prefers unsupported MIME evidence when duplicate sources conflict", () => {
    const result = validateCollectedVideos({
      ...page,
      candidates: [
        {
          url: "https://cdn.example.com/extensionless-stream",
          sourceKind: "media-element",
        },
        {
          url: "https://cdn.example.com/extensionless-stream",
          sourceKind: "source-element",
          mediaType: "application/vnd.apple.mpegurl",
        },
      ],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      format: "HLS",
      sourceType: "hls",
      support: { reason: "hls", status: "unsupported" },
    });
  });

  test("keeps different signed URLs distinct without displaying their queries", () => {
    const result = validateCollectedVideos({
      ...page,
      candidates: [
        {
          url: "https://cdn.example.com/video.mp4?token=one",
          sourceKind: "media-element",
        },
        {
          url: "https://cdn.example.com/video.mp4?token=two",
          sourceKind: "media-element",
        },
      ],
    });

    expect(result.candidates.map(({ url }) => url)).toEqual([
      "https://cdn.example.com/video.mp4?token=one",
      "https://cdn.example.com/video.mp4?token=two",
    ]);
    expect(result.candidates.map(({ displayName }) => displayName)).toEqual([
      "video.mp4",
      "video.mp4",
    ]);
    expect(new Set(result.candidates.map(({ id }) => id)).size).toBe(2);
  });

  test("rejects unsafe protocols, credentials, malformed values, and segments", () => {
    const result = validateCollectedVideos({
      ...page,
      candidates: [
        { url: "javascript:alert(1)", sourceKind: "media-element" },
        { url: "data:video/mp4;base64,AAAA", sourceKind: "media-element" },
        { url: "file:///tmp/video.mp4", sourceKind: "media-element" },
        {
          url: "https://user:password@example.com/video.mp4",
          sourceKind: "media-element",
        },
        { url: "https://example.com/segment.ts", sourceKind: "performance" },
        { url: "not a url", sourceKind: "media-element" },
        { url: "https://example.com/video.mp4", sourceKind: "unknown" },
      ],
    });

    expect(result.candidates).toEqual([]);
  });

  test("bounds untrusted strings, numbers, and candidate count", () => {
    const candidates = Array.from({ length: 80 }, (_, index) => ({
      url: `https://cdn.example.com/video-${index}.mp4`,
      sourceKind: "media-element",
      width: index === 0 ? Number.POSITIVE_INFINITY : 640,
      height: index === 0 ? -1 : 360,
      duration: index === 0 ? Number.NaN : 10,
      mediaType: "x".repeat(400),
    }));
    candidates.push({
      url: `https://example.com/${"x".repeat(9_000)}.mp4`,
      sourceKind: "media-element",
      width: 1,
      height: 1,
      duration: 1,
      mediaType: "video/mp4",
    });

    const result = validateCollectedVideos({
      pageTitle: `Title${"x".repeat(1_000)}`,
      pageUrl: page.pageUrl,
      candidates,
    });

    expect(result.pageTitle.length).toBeLessThanOrEqual(200);
    expect(result.candidates).toHaveLength(50);
    const invalidMetadataCandidate = result.candidates.find(({ url }) =>
      url.endsWith("/video-0.mp4"),
    );
    expect(invalidMetadataCandidate).not.toHaveProperty("width");
    expect(invalidMetadataCandidate).not.toHaveProperty("height");
    expect(invalidMetadataCandidate).not.toHaveProperty("duration");
  });

  test("sanitizes control and bidirectional characters from display text", () => {
    const result = validateCollectedVideos({
      pageTitle: "\u0000../Unsafe\n\u202eTitle",
      pageUrl: page.pageUrl,
      candidates: [
        {
          url: "https://cdn.example.com/%2E%2E/%00bad%0Aname.mp4?token=secret",
          sourceKind: "media-element",
          mediaType: "video/mp4",
        },
        {
          url: "https://cdn.example.com/",
          sourceKind: "media-element",
          mediaType: "video/mp4",
        },
      ],
    });

    expect(result.pageTitle).toBe("../Unsafe Title");
    expect(result.candidates[0]?.displayName).toBe("bad name.mp4");
    expect(result.candidates[1]?.displayName).toBe(
      "Video from cdn.example.com",
    );
    expect(
      result.candidates.map(({ displayName }) => displayName).join(" "),
    ).not.toContain("secret");
  });

  test("returns a safe empty result for a malformed payload", () => {
    expect(validateCollectedVideos(null)).toEqual({
      candidates: [],
      pageTitle: "Current page",
      pageUrl: "",
    });
    expect(validateCollectedVideos({ candidates: "not-an-array" })).toEqual({
      candidates: [],
      pageTitle: "Current page",
      pageUrl: "",
    });
  });
});
