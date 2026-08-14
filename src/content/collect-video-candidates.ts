export interface RawCollectedCandidate {
  url: string;
  sourceKind: string;
  mediaType?: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface RawCollection {
  pageTitle: string;
  pageUrl: string;
  candidates: RawCollectedCandidate[];
}

export function collectVideoCandidates(): RawCollection {
  const maxCandidates = 50;
  const mediaResourcePattern = /\.(?:m4v|mov|mp4|mpd|m3u8|ogv|webm)(?:$|[?#])/i;
  const candidates: RawCollectedCandidate[] = [];
  const candidateIndexes = new Map<string, number>();

  function add(candidate: RawCollectedCandidate): void {
    if (
      typeof candidate.url !== "string" ||
      candidate.url.length === 0 ||
      candidate.url.length > 8_192
    ) {
      return;
    }
    const existingIndex = candidateIndexes.get(candidate.url);
    if (existingIndex !== undefined) {
      const existing = candidates[existingIndex];
      if (existing && candidate.mediaType)
        existing.mediaType = candidate.mediaType;
      return;
    }
    if (candidates.length >= maxCandidates) return;
    candidateIndexes.set(candidate.url, candidates.length);
    candidates.push(candidate);
  }

  for (const video of document.querySelectorAll("video")) {
    if (candidates.length >= maxCandidates) break;
    const metadata = {
      ...(Number.isFinite(video.videoWidth) && video.videoWidth > 0
        ? { width: video.videoWidth }
        : {}),
      ...(Number.isFinite(video.videoHeight) && video.videoHeight > 0
        ? { height: video.videoHeight }
        : {}),
      ...(Number.isFinite(video.duration) && video.duration > 0
        ? { duration: video.duration }
        : {}),
    };
    const mediaType = video.getAttribute("type") ?? "";

    if (video.currentSrc) {
      add({
        ...metadata,
        url: video.currentSrc,
        sourceKind: "media-element",
        ...(mediaType ? { mediaType } : {}),
      });
    }
    const declaredSource = video.getAttribute("src");
    if (declaredSource) {
      add({
        ...metadata,
        url: video.src || declaredSource,
        sourceKind: "media-element",
        ...(mediaType ? { mediaType } : {}),
      });
    }
    let sourceCount = 0;
    for (const source of video.querySelectorAll("source")) {
      if (sourceCount >= 100) break;
      sourceCount += 1;
      const sourceUrl = source.src || source.getAttribute("src");
      if (!sourceUrl) continue;
      add({
        ...metadata,
        url: sourceUrl,
        sourceKind: "source-element",
        ...(source.type ? { mediaType: source.type } : {}),
      });
    }
    if (video.srcObject) {
      add({
        ...metadata,
        url: "mediastream:",
        sourceKind: "media-stream",
      });
    }
  }

  if (candidates.length < maxCandidates) {
    for (const entry of performance.getEntriesByType("resource")) {
      if (candidates.length >= maxCandidates) break;
      const resource = entry as PerformanceResourceTiming;
      if (
        typeof resource.name !== "string" ||
        !mediaResourcePattern.test(resource.name) ||
        !["fetch", "video", "xmlhttprequest"].includes(resource.initiatorType)
      ) {
        continue;
      }
      add({
        url: resource.name,
        sourceKind: "performance",
      });
    }
  }

  return {
    candidates,
    pageTitle: document.title,
    pageUrl: window.location.href,
  };
}
