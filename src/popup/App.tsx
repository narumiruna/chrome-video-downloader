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
import type { VideoCandidate } from "../core/video-candidate";
import {
  type DownloadResult,
  startVideoDownload,
} from "../platform/chrome-downloads";
import { type ScanPageResult, scanActivePage } from "../platform/chrome-tabs";
import {
  getMessages,
  resolveLocale,
  type SupportedLocale,
  unsupportedReason,
} from "./messages";
import { initialState, popupReducer } from "./state";
import "./styles.css";

export interface AppProps {
  locale?: SupportedLocale;
  scanPage?: () => Promise<ScanPageResult>;
  downloadVideo?: (candidate: VideoCandidate) => Promise<DownloadResult>;
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
  const pendingDownloadsRef = useRef(new Set<string>());

  const runScan = useCallback(async () => {
    const version = scanVersionRef.current + 1;
    scanVersionRef.current = version;
    dispatch({ type: "scan-started" });
    setAnnouncement(copy.scanning);
    try {
      const result = await scanPage();
      if (!mountedRef.current || scanVersionRef.current !== version) return;
      setAnnouncement("");
      if (result.status === "success") {
        dispatch({
          type: "scan-succeeded",
          candidates: result.candidates,
          pageTitle: result.pageTitle,
          pageUrl: result.pageUrl,
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
  }, [copy.scanning, scanPage]);

  useEffect(() => {
    mountedRef.current = true;
    document.documentElement.lang = locale;
    void runScan();
    return () => {
      mountedRef.current = false;
      scanVersionRef.current += 1;
      pendingDownloadsRef.current.clear();
    };
  }, [locale, runScan]);

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

  const anyDownloadStarting = Object.values(state.downloads).includes(
    "starting",
  );

  function scanButton() {
    return (
      <button
        className="secondary-button"
        disabled={state.scan.status === "scanning" || anyDownloadStarting}
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
            {candidateList(state.scan.candidates)}
          </>
        );
      case "unsupported-stream": {
        return (
          <section className="state-panel">
            <h1>{copy.unsupportedTitle}</h1>
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
        className="separator"
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
