export interface RawCollectedCandidate {
  url: string;
  sourceKind: string;
  mediaType?: string;
  width?: number;
  height?: number;
  duration?: number;
  isFromIframe?: boolean;
  iframeOrigin?: string;
}

export interface RawCollection {
  pageTitle: string;
  pageUrl: string;
  iframeUrls: string[];
  candidates: RawCollectedCandidate[];
}

export function collectVideoCandidates(): RawCollection {
  const maxCandidates = 50;
  const maxMediaTypeLength = 256;
  const maxPageTitleLength = 200;
  const maxPageUrlLength = 4_096;
  const mediaResourcePattern = /\.(?:m4v|mov|mp4|mpd|m3u8|ogv|webm)(?:$|[?#])/i;
  const candidates: RawCollectedCandidate[] = [];
  const candidateIndexes = new Map<string, number>();
  const iframeUrls: string[] = [];
  const visitedOrigins = new Set<string>();

  function cap(value: string, maxLength: number): string {
    return value.slice(0, maxLength);
  }

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

  // Collect iframe URLs from the page
  function collectIframeInfo(element: Element): void {
    const iframe = element as HTMLIFrameElement;
    const src = iframe.getAttribute("src");
    const srcdoc = iframe.getAttribute("srcdoc");

    if (src && !visitedOrigins.has(src)) {
      visitedOrigins.add(src);
      try {
        const url = new URL(src, window.location.href);
        if (
          url.origin !== window.location.origin &&
          url.protocol === "https:"
        ) {
          iframeUrls.push(url.href);

          // Check if this iframe might contain video
          const iframeHostname = url.hostname;
          const videoIframePatterns = [
            "vimeo",
            "youtube",
            "youku",
            "dailymotion",
            "twitch",
            "bilibili",
            "player",
            "embed",
            "video",
          ];
          const isVideoIframe = videoIframePatterns.some(
            (pattern) =>
              iframeHostname.includes(pattern) ||
              url.pathname.includes("video") ||
              url.pathname.includes("embed"),
          );

          if (isVideoIframe) {
            // Mark this as a potential video source
            add({
              url: url.href,
              sourceKind: "iframe",
              mediaType: "text/html",
              isFromIframe: true,
              iframeOrigin: url.origin,
            });
          }
        }
      } catch {
        // Ignore invalid URLs
      }
    }

    if (srcdoc) {
      try {
        // Check if srcdoc contains video elements
        if (
          srcdoc.includes("<video") ||
          srcdoc.includes("mp4") ||
          srcdoc.includes("webm")
        ) {
          add({
            url: "iframe-srcdoc",
            sourceKind: "iframe-srcdoc",
            isFromIframe: true,
            iframeOrigin: window.location.origin,
          });
        }
      } catch {
        // Ignore
      }
    }
  }

  // Collect from top frame
  for (const iframe of document.querySelectorAll("iframe")) {
    collectIframeInfo(iframe);
  }

  // Try to collect from same-origin iframes
  try {
    for (const element of document.querySelectorAll("iframe, embed, object")) {
      const iframe = element as HTMLIFrameElement;
      if (
        iframe.contentDocument ||
        (iframe.contentWindow &&
          new URL(iframe.src || "", window.location.origin).origin ===
            window.location.origin)
      ) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc) {
            for (const innerIframe of doc.querySelectorAll("iframe")) {
              collectIframeInfo(innerIframe);
            }

            // Also collect videos from same-origin iframes
            for (const video of doc.querySelectorAll("video")) {
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
                isFromIframe: true,
              };
              const mediaType = cap(
                video.getAttribute("type") ?? "",
                maxMediaTypeLength,
              );

              if (video.currentSrc) {
                add({
                  ...metadata,
                  url: video.currentSrc,
                  sourceKind: "media-element",
                  ...(mediaType ? { mediaType } : {}),
                });
              }
            }
          }
        } catch {
          // Access denied for cross-origin iframe
        }
      }
    }
  } catch {
    // Access denied
  }

  // Collect videos from top frame
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
    const mediaType = cap(video.getAttribute("type") ?? "", maxMediaTypeLength);

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
        ...(source.type
          ? { mediaType: cap(source.type, maxMediaTypeLength) }
          : {}),
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
    iframeUrls,
    pageTitle: cap(document.title, maxPageTitleLength),
    pageUrl: cap(window.location.href, maxPageUrlLength),
  };
}
