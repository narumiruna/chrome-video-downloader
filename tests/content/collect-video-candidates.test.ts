import { afterEach, describe, expect, test, vi } from "vitest";
import { collectVideoCandidates } from "../../src/content/collect-video-candidates";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("collectVideoCandidates", () => {
  test("collects current, declared, and child sources with media metadata", () => {
    document.title = "Fixture";
    document.body.innerHTML = `
      <video id="video" src="https://cdn.example.com/declared.mp4" type="video/mp4">
        <source src="https://cdn.example.com/fallback.webm" type="video/webm" />
      </video>
    `;
    const video = document.querySelector<HTMLVideoElement>("#video");
    if (!video) throw new Error("missing fixture video");
    Object.defineProperties(video, {
      currentSrc: { value: "https://cdn.example.com/current.mp4" },
      duration: { value: 42.5 },
      videoHeight: { value: 720 },
      videoWidth: { value: 1280 },
    });

    const result = collectVideoCandidates();

    expect(result.pageTitle).toBe("Fixture");
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://cdn.example.com/current.mp4",
          sourceKind: "media-element",
          width: 1280,
          height: 720,
          duration: 42.5,
        }),
        expect.objectContaining({
          url: "https://cdn.example.com/declared.mp4",
          sourceKind: "media-element",
          mediaType: "video/mp4",
        }),
        expect.objectContaining({
          url: "https://cdn.example.com/fallback.webm",
          sourceKind: "source-element",
          mediaType: "video/webm",
        }),
      ]),
    );
  });

  test("reports blob and MediaStream sources without reading their bytes", () => {
    document.body.innerHTML =
      '<video id="video" src="blob:https://example.com/id"></video>';
    const video = document.querySelector<HTMLVideoElement>("#video");
    if (!video) throw new Error("missing fixture video");
    Object.defineProperties(video, {
      currentSrc: { value: "blob:https://example.com/id" },
      srcObject: { value: {} },
    });

    const result = collectVideoCandidates();

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "blob:https://example.com/id" }),
        expect.objectContaining({
          url: "mediastream:",
          sourceKind: "media-stream",
        }),
      ]),
    );
  });

  test("keeps only explicit media-like performance resources and caps output", () => {
    const entries = [
      { name: "https://cdn.example.com/api", initiatorType: "fetch" },
      ...Array.from({ length: 80 }, (_, index) => ({
        name: `https://cdn.example.com/video-${index}.mp4`,
        initiatorType: "fetch",
      })),
      ...Array.from({ length: 80 }, (_, index) => ({
        name: `https://cdn.example.com/segment-${index}.ts`,
        initiatorType: "xmlhttprequest",
      })),
      { name: "https://cdn.example.com/master.m3u8", initiatorType: "fetch" },
    ] as PerformanceResourceTiming[];
    vi.spyOn(performance, "getEntriesByType").mockReturnValue(entries);

    const result = collectVideoCandidates();

    expect(result.candidates).toHaveLength(50);
    expect(result.candidates.every(({ url }) => !url.endsWith(".ts"))).toBe(
      true,
    );
    expect(result.candidates.every(({ url }) => !url.endsWith("/api"))).toBe(
      true,
    );
  });

  test("deduplicates repeated source URLs and keeps later MIME evidence", () => {
    document.body.innerHTML = `
      <video>
        <source
          src="https://cdn.example.com/extensionless-stream"
          type="application/vnd.apple.mpegurl"
        />
      </video>
    `;
    const video = document.querySelector("video");
    if (!video) throw new Error("missing fixture video");
    Object.defineProperty(video, "currentSrc", {
      value: "https://cdn.example.com/extensionless-stream",
    });

    const result = collectVideoCandidates();
    const matches = result.candidates.filter(
      ({ url }) => url === "https://cdn.example.com/extensionless-stream",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.mediaType).toBe("application/vnd.apple.mpegurl");
  });

  test("drops overlong page-controlled URLs before crossing the extension boundary", () => {
    const longUrl = `https://cdn.example.com/${"x".repeat(9_000)}.mp4`;
    document.body.innerHTML = `<video src="${longUrl}"></video>`;

    expect(collectVideoCandidates().candidates).toEqual([]);
  });
});
