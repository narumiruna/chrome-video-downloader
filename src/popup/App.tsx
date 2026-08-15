import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Separator from "@radix-ui/react-separator";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  type AssemblyProgress,
  assembleCapturedMp4,
} from "../core/assemble-captured-mp4";
import {
  capturedMp4TrackKind,
  isCapturedMp4PlaylistMetadata,
} from "../core/captured-mp4-metadata";
import { parsePlaybackProgress } from "../core/playback-progress";
import type { VideoCandidate } from "../core/video-candidate";
import {
  type DownloadResult,
  startBlobDownload,
  startVideoDownload,
} from "../platform/chrome-downloads";
import { type ScanPageResult, scanActivePage } from "../platform/chrome-tabs";
import {
  getMessages,
  resolveLocale,
  type SupportedLocale,
  unsupportedReason,
} from "./messages";
import type { CapturedVideo } from "./state";
import { initialState, popupReducer } from "./state";
import "./styles.css";

export interface PopupRuntime {
  onMessage: {
    addListener(
      listener: (
        message: unknown,
        sender: chrome.runtime.MessageSender,
      ) => void,
    ): void;
    removeListener(
      listener: (
        message: unknown,
        sender: chrome.runtime.MessageSender,
      ) => void,
    ): void;
  };
}

export interface AppProps {
  locale?: SupportedLocale;
  scanPage?: () => Promise<ScanPageResult>;
  downloadVideo?: (candidate: VideoCandidate) => Promise<DownloadResult>;
  getCapturedVideos?: () => Promise<CapturedVideo[]>;
  assembleVideo?: typeof assembleCapturedMp4;
  downloadAssembledVideo?: typeof startBlobDownload;
  runtime?: PopupRuntime | null;
}

function defaultRuntime(): PopupRuntime | null {
  return typeof chrome === "undefined" ? null : chrome.runtime;
}

function parseCapturedVideos(value: unknown): CapturedVideo[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is CapturedVideo =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as CapturedVideo).url === "string" &&
      typeof (item as CapturedVideo).mimeType === "string" &&
      typeof (item as CapturedVideo).timestamp === "number" &&
      ((item as CapturedVideo).range === undefined ||
        typeof (item as CapturedVideo).range === "string"),
  );
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
        .toString()
        .padStart(2, "0")}`
    : `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function assembledFilename(pageTitle: string): string {
  const safeTitle = Array.from(pageTitle, (character) =>
    (character.codePointAt(0) ?? 0) < 32 || '<>:"/\\|?*'.includes(character)
      ? " "
      : character,
  ).join("");
  const basename = safeTitle.replace(/\s+/g, " ").trim().slice(0, 120);
  return `${basename || "video"}.mp4`;
}

function progressNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function ProgressBar({
  completed,
  label,
  total,
}: {
  completed: number;
  label: string;
  total: number;
}) {
  const percentage =
    total > 0 ? Math.min(100, Math.max(0, (completed / total) * 100)) : 0;
  return (
    <div className="progress-block">
      <div
        aria-label={label}
        aria-valuemax={total}
        aria-valuemin={0}
        aria-valuenow={completed}
        className="progress-bar"
        role="progressbar"
      >
        <div
          className="progress-bar-fill"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="progress-text">
        {label}: {progressNumber(completed)}/{progressNumber(total)} (
        {Math.round(percentage)}%)
      </p>
    </div>
  );
}

function candidateMetadata(candidate: VideoCandidate): string[] {
  const metadata = [candidate.format];
  if (candidate.width && candidate.height)
    metadata.push(`${candidate.width}×${candidate.height}`);
  if (candidate.duration) metadata.push(formatDuration(candidate.duration));
  return metadata;
}

export function App({
  locale: requestedLocale,
  scanPage = scanActivePage,
  downloadVideo = startVideoDownload,
  getCapturedVideos,
  assembleVideo = assembleCapturedMp4,
  downloadAssembledVideo = startBlobDownload,
  runtime = defaultRuntime(),
}: AppProps) {
  const locale = useMemo(
    () => resolveLocale(requestedLocale),
    [requestedLocale],
  );
  const copy = useMemo(() => getMessages(locale), [locale]);
  const [state, dispatch] = useReducer(popupReducer, initialState);
  const [announcement, setAnnouncement] = useState(copy.scanning);
  const mountedRef = useRef(false);
  const scanVersionRef = useRef(0);
  const activeTabIdRef = useRef<number | null>(null);
  const pendingDownloadsRef = useRef(new Set<string>());

  const runScan = useCallback(async () => {
    const version = scanVersionRef.current + 1;
    scanVersionRef.current = version;
    dispatch({ type: "scan-started" });
    activeTabIdRef.current = null;
    setAnnouncement(copy.scanning);
    try {
      const result = await scanPage();
      if (!mountedRef.current || scanVersionRef.current !== version) return;
      setAnnouncement("");
      if (result.status === "success") {
        let capturedVideos: CapturedVideo[] = result.capturedVideos;

        if (getCapturedVideos) {
          try {
            capturedVideos = await getCapturedVideos();
          } catch {
            // Keep the videos returned by the page scan.
          }
        }

        activeTabIdRef.current = result.tabId;
        dispatch({
          type: "scan-succeeded",
          candidates: result.candidates,
          capturedVideos,
          iframeUrls: result.iframeUrls,
          pageTitle: result.pageTitle,
          pageUrl: result.pageUrl,
          playbackProgress: result.playbackProgress,
          tabId: result.tabId,
        });
      } else if (result.status === "restricted") {
        dispatch({ type: "scan-restricted", pageTitle: result.pageTitle });
      } else {
        dispatch({ type: "scan-failed" });
      }
    } catch {
      if (!mountedRef.current || scanVersionRef.current !== version) return;
      setAnnouncement("");
      dispatch({ type: "scan-failed" });
    }
  }, [copy.scanning, scanPage, getCapturedVideos]);

  useEffect(() => {
    mountedRef.current = true;
    document.documentElement.lang = locale;
    void runScan();
    return () => {
      mountedRef.current = false;
      scanVersionRef.current += 1;
      activeTabIdRef.current = null;
      pendingDownloadsRef.current.clear();
    };
  }, [locale, runScan]);

  useEffect(() => {
    if (!runtime) return;
    const onMessage = (message: unknown): void => {
      if (!message || typeof message !== "object") return;
      const value = message as Record<string, unknown>;
      const tabId = value.tabId;
      if (
        typeof tabId !== "number" ||
        tabId !== activeTabIdRef.current ||
        !Number.isInteger(tabId)
      ) {
        return;
      }
      const playback = parsePlaybackProgress(value.playback);
      if (!playback) return;

      if (value.type === "playbackProgress") {
        dispatch({ type: "playback-progress-update", playback });
        return;
      }
      if (value.type === "triggerAssembly") {
        dispatch({
          type: "assembly-ready",
          capturedVideos: parseCapturedVideos(value.videos),
          playback,
          tabId,
        });
        setAnnouncement(copy.playbackComplete);
      }
    };
    runtime.onMessage.addListener(onMessage);
    return () => runtime.onMessage.removeListener(onMessage);
  }, [copy.playbackComplete, runtime]);

  const handleDownload = useCallback(
    async (candidate: VideoCandidate) => {
      if (
        candidate.support.status !== "downloadable" ||
        pendingDownloadsRef.current.has(candidate.id)
      ) {
        return;
      }
      pendingDownloadsRef.current.add(candidate.id);
      dispatch({ type: "download-started", id: candidate.id });
      setAnnouncement("");
      try {
        const result = await downloadVideo(candidate);
        if (!mountedRef.current) return;
        if (result.status === "accepted") {
          dispatch({ type: "download-accepted", id: candidate.id });
          setAnnouncement(copy.sentStatus);
        } else {
          dispatch({ type: "download-failed", id: candidate.id });
          setAnnouncement(copy.downloadError);
        }
      } catch {
        if (!mountedRef.current) return;
        dispatch({ type: "download-failed", id: candidate.id });
        setAnnouncement(copy.downloadError);
      } finally {
        pendingDownloadsRef.current.delete(candidate.id);
      }
    },
    [copy.downloadError, copy.sentStatus, downloadVideo],
  );

  const handleAssembly = useCallback(
    async (capturedVideos: CapturedVideo[], pageTitle: string) => {
      if (
        state.assembly.status === "fetching" ||
        state.assembly.status === "muxing"
      ) {
        return;
      }

      dispatch({
        type: "assembly-progress",
        assembly: {
          status: "fetching",
          completed: 0,
          total: capturedVideos.length,
        },
      });
      setAnnouncement(copy.fetchingParts);
      try {
        const blob = await assembleVideo(capturedVideos, {
          onProgress: (progress: AssemblyProgress) => {
            if (!mountedRef.current) return;
            dispatch({
              type: "assembly-progress",
              assembly: {
                status: progress.phase,
                completed: progress.completed,
                total: progress.total,
              },
            });
            setAnnouncement(
              progress.phase === "muxing" ? copy.muxing : copy.fetchingParts,
            );
          },
        });
        const result = await downloadAssembledVideo(
          blob,
          assembledFilename(pageTitle),
        );
        if (!mountedRef.current) return;
        if (result.status === "accepted") {
          dispatch({
            type: "assembly-progress",
            assembly: { status: "accepted" },
          });
          setAnnouncement(copy.sentStatus);
        } else {
          dispatch({
            type: "assembly-progress",
            assembly: { status: "error" },
          });
          setAnnouncement(copy.assemblyError);
        }
      } catch {
        if (!mountedRef.current) return;
        dispatch({
          type: "assembly-progress",
          assembly: { status: "error" },
        });
        setAnnouncement(copy.assemblyError);
      }
    },
    [
      assembleVideo,
      state.assembly.status,
      copy.assemblyError,
      copy.fetchingParts,
      copy.muxing,
      copy.sentStatus,
      downloadAssembledVideo,
    ],
  );

  const anyDownloadStarting = Object.values(state.downloads).includes(
    "starting",
  );
  const assemblyInProgress =
    state.assembly.status === "fetching" || state.assembly.status === "muxing";

  function scanButton() {
    return (
      <button
        className="secondary-button"
        disabled={
          state.scan.status === "scanning" ||
          anyDownloadStarting ||
          assemblyInProgress
        }
        onClick={() => void runScan()}
        type="button"
      >
        {copy.scanAgain}
      </button>
    );
  }

  function candidateList(candidates: VideoCandidate[]) {
    return (
      <ScrollArea.Root className="candidate-scroll">
        <ScrollArea.Viewport className="candidate-viewport">
          <ul className="candidate-list">
            {candidates.map((candidate) => {
              const downloadState = state.downloads[candidate.id];
              const buttonText =
                downloadState === "starting"
                  ? copy.downloading
                  : downloadState === "accepted"
                    ? copy.sentButton
                    : downloadState === "error"
                      ? copy.retry
                      : copy.download;
              return (
                <li className="candidate-card" key={candidate.id}>
                  <div className="candidate-heading-row">
                    <h2>{candidate.displayName}</h2>
                    {candidate.support.status === "unsupported" ? (
                      <span className="unsupported-badge">
                        {copy.unsupported}
                      </span>
                    ) : null}
                  </div>
                  <p className="metadata">
                    {candidateMetadata(candidate).map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </p>
                  <p className="hostname">
                    {copy.sourceHost}: {candidate.hostname}
                  </p>
                  {candidate.support.status === "downloadable" ? (
                    <button
                      aria-label={`${copy.download} ${candidate.displayName}`}
                      className="primary-button"
                      disabled={
                        downloadState === "starting" ||
                        downloadState === "accepted"
                      }
                      onClick={() => void handleDownload(candidate)}
                      type="button"
                    >
                      {buttonText}
                    </button>
                  ) : (
                    <p className="unsupported-reason">
                      {unsupportedReason(locale, candidate.support.reason)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="scrollbar" orientation="vertical">
          <ScrollArea.Thumb className="scroll-thumb" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    );
  }

  function iframeInfoSection(iframeUrls: string[]) {
    if (iframeUrls.length === 0) return null;

    // Filter to show only video-related iframes
    const videoIframes = iframeUrls.filter((url) => {
      try {
        const parsed = new URL(url);
        return (
          parsed.hostname.includes("vimeo") ||
          parsed.hostname.includes("youtube") ||
          parsed.pathname.includes("video") ||
          parsed.pathname.includes("embed")
        );
      } catch {
        return false;
      }
    });

    if (videoIframes.length === 0) return null;

    return (
      <div className="iframe-info-section">
        <h3>Detected video iframes</h3>
        <ul className="iframe-list">
          {videoIframes.map((url) => (
            <li key={url} className="iframe-item">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="iframe-link"
              >
                {url.length > 80 ? `${url.substring(0, 80)}...` : url}
              </a>
              <span className="iframe-tag">video</span>
            </li>
          ))}
        </ul>
        <p className="iframe-hint">
          Click to open the video page. The extension can capture video URLs
          from this iframe.
        </p>
      </div>
    );
  }

  function capturedVideoSection(
    capturedVideos: CapturedVideo[],
    pageTitle: string,
  ) {
    const assemblyInputs = capturedVideos.filter(
      (video) =>
        capturedMp4TrackKind(video) !== null ||
        isCapturedMp4PlaylistMetadata(video),
    );
    const mp4Parts = assemblyInputs.filter(
      (video) => capturedMp4TrackKind(video) !== null,
    );
    const videoCount = mp4Parts.filter(
      (part) => capturedMp4TrackKind(part) === "video",
    ).length;
    const audioCount = mp4Parts.length - videoCount;
    const hasFragmentEvidence =
      audioCount > 0 ||
      mp4Parts.some((part) => /\.m4s(?:$|[?#])/i.test(part.url));
    if (videoCount === 0 || !hasFragmentEvidence) return null;

    const playback = state.playbackProgress;
    const playbackPercentage =
      playback && playback.duration > 0
        ? Math.min(
            100,
            Math.max(0, (playback.currentTime / playback.duration) * 100),
          )
        : 0;
    const buttonText =
      state.assembly.status === "fetching"
        ? copy.fetchingParts
        : state.assembly.status === "muxing"
          ? copy.muxing
          : state.assembly.status === "accepted"
            ? copy.sentButton
            : state.assembly.status === "error"
              ? copy.retry
              : playback?.assemblyReady
                ? copy.autoAssemble
                : copy.assemble;

    return (
      <div className="captured-video-section">
        <h3>{copy.capturedStreamTitle}</h3>
        <p className="captured-video-hint">{copy.capturedStreamHint}</p>
        {playback && playback.duration > 0 ? (
          <div className="playback-progress">
            <ProgressBar
              completed={playback.currentTime}
              label={copy.playbackProgress}
              total={playback.duration}
            />
            <p className="playback-time">
              {formatDuration(playback.currentTime)} /{" "}
              {formatDuration(playback.duration)} (
              {Math.round(playbackPercentage)}%)
            </p>
            {playback.ended ? (
              <p className="status-badge success">{copy.playbackComplete}</p>
            ) : null}
          </div>
        ) : null}
        <p className="metadata captured-part-counts">
          <span>video/mp4 × {videoCount}</span>
          {audioCount > 0 ? <span>audio/mp4 × {audioCount}</span> : null}
        </p>
        {state.assembly.status === "fetching" ? (
          <ProgressBar
            completed={state.assembly.completed}
            label={copy.fetchingPartsProgress}
            total={state.assembly.total}
          />
        ) : null}
        {state.assembly.status === "muxing" ? (
          <ProgressBar
            completed={state.assembly.completed}
            label={copy.muxingProgress}
            total={state.assembly.total}
          />
        ) : null}
        <button
          type="button"
          className="primary-button"
          disabled={assemblyInProgress || state.assembly.status === "accepted"}
          onClick={() => void handleAssembly(assemblyInputs, pageTitle)}
        >
          {buttonText}
        </button>
        {state.assembly.status === "error" ? (
          <p className="unsupported-reason">{copy.assemblyError}</p>
        ) : null}
      </div>
    );
  }

  function content() {
    switch (state.scan.status) {
      case "scanning":
        return (
          <section className="state-panel" aria-labelledby="scanning-heading">
            <div className="spinner" aria-hidden="true" />
            <h1 id="scanning-heading">{copy.scanning}</h1>
          </section>
        );
      case "found":
        return (
          <>
            <div className="page-heading">
              <div>
                <p className="eyebrow">{copy.appName}</p>
                <h1>{state.scan.pageTitle}</h1>
              </div>
              {scanButton()}
            </div>
            {iframeInfoSection(state.scan.iframeUrls)}
            {capturedVideoSection(
              state.scan.capturedVideos,
              state.scan.pageTitle,
            )}
            {candidateList(state.scan.candidates)}
          </>
        );
      case "unsupported-stream": {
        return (
          <section className="state-panel">
            <h1>{copy.unsupportedTitle}</h1>
            {iframeInfoSection(state.scan.iframeUrls)}
            {capturedVideoSection(
              state.scan.capturedVideos,
              state.scan.pageTitle,
            )}
            {candidateList(state.scan.candidates)}
            {scanButton()}
          </section>
        );
      }
      case "empty":
        return (
          <section className="state-panel">
            <h1>{copy.emptyTitle}</h1>
            <p>{copy.emptyMessage}</p>
            {iframeInfoSection(state.scan.iframeUrls)}
            {capturedVideoSection(
              state.scan.capturedVideos,
              state.scan.pageTitle,
            )}
            {scanButton()}
          </section>
        );
      case "restricted":
        return (
          <section className="state-panel">
            <h1>{copy.restrictedTitle}</h1>
            <p>{copy.restrictedMessage}</p>
          </section>
        );
      case "error":
        return (
          <section className="state-panel">
            <h1>{copy.errorTitle}</h1>
            <p>{copy.errorMessage}</p>
            {scanButton()}
          </section>
        );
    }
  }

  return (
    <main className="popup-shell">
      {content()}
      <p className="live-status" role="status" aria-live="polite">
        {announcement}
      </p>
      <Separator.Root
        className={`separator${announcement ? "" : " separator-after-empty-status"}`}
        decorative
        orientation="horizontal"
      />
      <footer>
        <p>{copy.privacyNotice}</p>
        <p>{copy.rightsNotice}</p>
      </footer>
    </main>
  );
}
