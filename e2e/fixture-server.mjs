import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureRoot = fileURLToPath(new URL("./fixtures/", import.meta.url));
const mediaRoot = join(fixtureRoot, "media");
const manifestRoot = join(fixtureRoot, "manifests");
const localDashRoot = fileURLToPath(
  new URL("../tests/fixtures/local-streams/dash/", import.meta.url),
);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".m3u8", "application/vnd.apple.mpegurl"],
  [".m4s", "video/iso.segment"],
  [".mp4", "video/mp4"],
  [".mpd", "application/dash+xml"],
  [".ts", "video/mp2t"],
  [".webm", "video/webm"],
]);

const pages = new Set([
  "blob.html",
  "captured-stream.html",
  "direct.html",
  "dynamic.html",
  "empty.html",
  "extensionless.html",
  "iframe-content.html",
  "iframe.html",
  "protected.html",
  "segments.html",
  "streams.html",
]);

function safeManifestPath(pathname) {
  const match = /^\/manifests\/(hls|dash)\/([a-zA-Z0-9.-]+)$/.exec(pathname);
  return match ? join(manifestRoot, match[1], match[2]) : null;
}

function capturedStreamPart(pathname) {
  const match = /^\/captured\/(video|audio)\/([a-zA-Z0-9.-]+)$/.exec(pathname);
  return match
    ? {
        contentType: `${match[1]}/mp4`,
        path: join(localDashRoot, match[2]),
      }
    : null;
}

async function sendFile(request, response, path, options = {}) {
  const file = await stat(path);
  const range = request.headers.range;
  const headers = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type":
      options.contentType ??
      contentTypes.get(extname(path)) ??
      "application/octet-stream",
    ...(options.filename
      ? { "Content-Disposition": `attachment; filename="${options.filename}"` }
      : {}),
  };

  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = match ? Number(match[1]) : Number.NaN;
    const requestedEnd = match?.[2] ? Number(match[2]) : file.size - 1;
    const end = Math.min(requestedEnd, file.size - 1);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end
    ) {
      response.writeHead(416, { "Content-Range": `bytes */${file.size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      ...headers,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${file.size}`,
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(path, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, { ...headers, "Content-Length": file.size });
  if (request.method === "HEAD") response.end();
  else createReadStream(path).pipe(response);
}

async function capturedPlaylist() {
  const [videoInit, audioInit] = await Promise.all([
    readFile(join(localDashRoot, "init-stream0.m4s")),
    readFile(join(localDashRoot, "init-stream1.m4s")),
  ]);
  return {
    base_url: "/captured/",
    video: [
      {
        base_url: "video/",
        init_segment: videoInit.toString("base64"),
        segments: [
          { url: "chunk-stream0-00001.m4s" },
          { url: "chunk-stream0-00002.m4s" },
        ],
      },
    ],
    audio: [
      {
        base_url: "audio/",
        init_segment: audioInit.toString("base64"),
        segments: [
          { url: "chunk-stream1-00001.m4s" },
          { url: "chunk-stream1-00002.m4s" },
          { url: "chunk-stream1-00003.m4s" },
        ],
      },
    ],
  };
}

function sendJson(response, value) {
  const content = JSON.stringify(value);
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(content),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(content);
}

function notFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

function mainHandler(request, response) {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:4173");
    if (url.pathname === "/") {
      response.writeHead(302, { Location: "/direct.html" });
      response.end();
      return;
    }
    const page = url.pathname.slice(1);
    if (pages.has(page)) {
      await sendFile(request, response, join(fixtureRoot, page));
      return;
    }
    if (url.pathname === "/media/sample.mp4") {
      await sendFile(request, response, join(mediaRoot, "sample.mp4"));
      return;
    }
    if (url.pathname === "/media/sample.webm") {
      await sendFile(request, response, join(mediaRoot, "sample.webm"));
      return;
    }
    if (url.pathname === "/media/no-extension") {
      await sendFile(request, response, join(mediaRoot, "sample.mp4"), {
        contentType: "video/mp4",
        filename: "sample.mp4",
      });
      return;
    }
    if (url.pathname === "/protected/sample.mp4") {
      if (
        !request.headers.cookie?.split(/;\s*/).includes("fixture_auth=allowed")
      ) {
        response.writeHead(401, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end("Authentication required");
        return;
      }
      await sendFile(request, response, join(mediaRoot, "sample.mp4"));
      return;
    }
    const manifestPath = safeManifestPath(url.pathname);
    if (manifestPath) {
      await sendFile(request, response, manifestPath);
      return;
    }
    if (url.pathname === "/captured/playlist.json") {
      sendJson(response, await capturedPlaylist());
      return;
    }
    const capturedPart = capturedStreamPart(url.pathname);
    if (capturedPart) {
      await sendFile(request, response, capturedPart.path, {
        contentType: capturedPart.contentType,
      });
      return;
    }
    notFound(response);
  })().catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
}

function iframeHandler(request, response) {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:4174");
    if (url.pathname === "/iframe-content.html") {
      await sendFile(
        request,
        response,
        join(fixtureRoot, "iframe-content.html"),
      );
      return;
    }
    notFound(response);
  })().catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
}

const servers = [createServer(mainHandler), createServer(iframeHandler)];
servers[0].listen(4173, "127.0.0.1");
servers[1].listen(4174, "127.0.0.1");
console.log("Fixture servers ready on 4173 and 4174");

function shutdown() {
  for (const server of servers) server.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
