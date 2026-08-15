import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const artifactRoot = resolve("dist/chrome");
const expectedPermissions = [
  "activeTab",
  "alarms",
  "downloads",
  "scripting",
  "storage",
  "webRequest",
];
const expectedHostPermissions = ["<all_urls>"];
const forbiddenManifestKeys = [
  "content_scripts",
  "optional_host_permissions",
  "optional_permissions",
];
const forbiddenPatterns = [
  { label: "eval", pattern: /eval\s*\(/ },
  { label: "Function constructor", pattern: /new\s+Function\s*\(/ },
  { label: "source map reference", pattern: /sourceMappingURL/ },
  { label: "localhost URL", pattern: /https?:\/\/(?:localhost|127\.0\.0\.1)/ },
  { label: "test token", pattern: /(?:fixture|top)-secret/ },
  {
    label: "local adaptive CLI runtime",
    pattern:
      /(?:DASH SegmentTemplate requires|fast-xml-parser|track manifest must use version 1)/,
  },
  { label: "remote script", pattern: /<script[^>]+src=["']https?:\/\//i },
  {
    label: "remote CSS import",
    pattern: /@import\s+(?:url\()?['"]?https?:\/\//i,
  },
];
const requiredFiles = [
  "LICENSE.txt",
  "THIRD_PARTY_NOTICES.txt",
  "_locales/en/messages.json",
  "_locales/zh_TW/messages.json",
  "action/index.css",
  "action/index.html",
  "action/index.js",
  "background/service_worker.js",
  "images/icon-128.png",
  "manifest.json",
];

async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(path)));
    else paths.push(path);
  }
  return paths;
}

const failures = [];
const manifest = JSON.parse(
  await readFile(join(artifactRoot, "manifest.json"), "utf8"),
);
const permissions = [...(manifest.permissions ?? [])].sort();
if (JSON.stringify(permissions) !== JSON.stringify(expectedPermissions)) {
  failures.push(`unexpected permissions: ${JSON.stringify(permissions)}`);
}
const hostPermissions = [...(manifest.host_permissions ?? [])].sort();
if (
  JSON.stringify(hostPermissions) !== JSON.stringify(expectedHostPermissions)
) {
  failures.push(
    `unexpected host permissions: ${JSON.stringify(hostPermissions)}`,
  );
}
for (const key of forbiddenManifestKeys) {
  if (key in manifest) failures.push(`forbidden manifest key: ${key}`);
}
if (manifest.manifest_version !== 3) failures.push("manifest_version is not 3");
if (manifest.minimum_chrome_version !== "102") {
  failures.push("minimum_chrome_version is missing or unexpected");
}
if (manifest.action?.default_popup !== "action/index.html") {
  failures.push("action popup path is missing or unexpected");
}
if (manifest.background?.service_worker !== "background/service_worker.js") {
  failures.push("background service worker path is missing or unexpected");
}

const files = await walk(artifactRoot);
const relativePaths = files.map((path) => relative(artifactRoot, path));
for (const path of requiredFiles) {
  if (!relativePaths.includes(path))
    failures.push(`missing required artifact: ${path}`);
}
for (const path of relativePaths) {
  if (path.endsWith(".map")) failures.push(`source map shipped: ${path}`);
}

for (const path of files) {
  const extension = extname(path);
  if (![".css", ".html", ".js", ".json"].includes(extension)) continue;
  const content = await readFile(path, "utf8");
  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(content))
      failures.push(`${label} found in ${relative(artifactRoot, path)}`);
  }
}

const zipFiles = files.filter((path) => path.endsWith(".zip"));
if (zipFiles.length !== 1) {
  failures.push(`expected one release zip, found ${zipFiles.length}`);
} else {
  if ((await stat(zipFiles[0])).size === 0)
    failures.push("release zip is empty");
  const zipCheck = spawnSync("unzip", ["-tq", zipFiles[0]], {
    encoding: "utf8",
  });
  if (zipCheck.status !== 0)
    failures.push(`release zip failed integrity check: ${zipCheck.stderr}`);
  const zipList = spawnSync("unzip", ["-Z1", zipFiles[0]], {
    encoding: "utf8",
  });
  const zipPaths = new Set(zipList.stdout.trim().split("\n"));
  for (const path of requiredFiles) {
    if (!zipPaths.has(path)) failures.push(`release zip is missing: ${path}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Artifact audit failed:\n- ${failures.join("\n- ")}`);
}

console.log(
  `Artifact audit passed: ${relativePaths.length} files, ${permissions.length} permissions, one valid zip.`,
);
