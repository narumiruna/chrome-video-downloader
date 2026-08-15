import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test,
} from "@playwright/test";

const fixtureOrigin = "http://127.0.0.1:4173";
const productionExtensionPath = resolve("dist/chrome");
const expectedHashes = {
  mp4: "4ea106e27b5ba27763d22eb5322aa519b1c152c38036bca6a4bb277e25455257",
  webm: "4d5e3e59f9e67f1e5696d3e0883c13b406de707374d6f56df3b80847cd345f13",
};

function extensionId(extensionPath: string): string {
  const digest = createHash("sha256")
    .update(extensionPath)
    .digest("hex")
    .slice(0, 32);
  return [...digest]
    .map((character) =>
      String.fromCharCode(97 + Number.parseInt(character, 16)),
    )
    .join("");
}

async function launchExtension(extensionPath: string, downloadsPath?: string) {
  return chromium.launchPersistentContext("", {
    acceptDownloads: true,
    channel: "chromium",
    downloadsPath,
    headless: process.env.HEADED !== "1",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
}

async function latestDownload(popup: Page) {
  return popup.evaluate(async () => {
    const [item] = await chrome.downloads.search({
      limit: 1,
      orderBy: ["-startTime"],
    });
    if (!item) return null;
    return {
      error: item.error,
      filename: item.filename,
      id: item.id,
      state: item.state,
    };
  });
}

async function hashFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

test("production artifact loads with the restricted-page recovery state", async () => {
  const context = await launchExtension(productionExtensionPath);
  try {
    const popup = await context.newPage();
    await popup.goto(
      `chrome-extension://${extensionId(productionExtensionPath)}/action/index.html`,
    );
    await expect(
      popup.getByRole("heading", { name: "This page is restricted" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test.describe
  .serial("extension behavior on controlled fixtures", () => {
    let context: BrowserContext;
    let fixture: Page;
    let popup: Page;
    let temporaryRoot: string;
    let extensionPath: string;
    let downloadsPath: string;

    test.beforeAll(async () => {
      temporaryRoot = await mkdtemp(
        join(tmpdir(), "chrome-video-downloader-e2e-"),
      );
      extensionPath = join(temporaryRoot, "extension");
      downloadsPath = join(temporaryRoot, "downloads");
      await cp(productionExtensionPath, extensionPath, { recursive: true });
      const manifestPath = join(extensionPath, "manifest.json");
      const manifest = JSON.parse(
        await readFile(manifestPath, "utf8"),
      ) as Record<string, unknown>;
      manifest.host_permissions = ["http://127.0.0.1/*"];
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      context = await launchExtension(extensionPath, downloadsPath);
      fixture = await context.newPage();
      await fixture.goto(`${fixtureOrigin}/empty.html`);
      popup = await context.newPage();
      await popup.goto(
        `chrome-extension://${extensionId(extensionPath)}/action/index.html`,
      );
    });

    test.afterAll(async () => {
      await context?.close();
      if (temporaryRoot)
        await rm(temporaryRoot, { force: true, recursive: true });
    });

    async function scan(path: string, expectedHeading: string): Promise<void> {
      await fixture.goto(`${fixtureOrigin}/${path}`);
      await fixture.bringToFront();
      await popup.reload();
      await expect(
        popup.getByRole("heading", { name: expectedHeading }),
      ).toBeVisible();
    }

    async function downloadAndVerify(
      buttonName: string,
      expectedHash: string,
    ): Promise<void> {
      const previous = await latestDownload(popup);
      await popup.getByRole("button", { name: buttonName }).click();
      await expect
        .poll(async () => {
          const item = await latestDownload(popup);
          return item?.id === previous?.id ? null : item;
        })
        .toMatchObject({ state: "complete" });
      const item = await latestDownload(popup);
      expect(item?.error).toBeUndefined();
      expect(item?.filename).toBeTruthy();
      expect(await hashFile(item?.filename ?? "")).toBe(expectedHash);
    }

    test("downloads direct MP4 and WebM files byte-for-byte", async () => {
      await scan("direct.html", "Direct video fixture");
      await expect(popup.getByText("320×180").first()).toBeVisible();
      await downloadAndVerify("Download sample.mp4", expectedHashes.mp4);
      await downloadAndVerify("Download sample.webm", expectedHashes.webm);
    });

    test("keeps popup proportions stable across empty and found states", async () => {
      async function popupDimensions() {
        return popup.locator(".popup-shell").evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return { height: bounds.height, width: bounds.width };
        });
      }

      await scan("empty.html", "No direct videos found");
      const empty = await popupDimensions();
      expect(empty.width).toBeGreaterThanOrEqual(390);
      expect(empty.width).toBeLessThanOrEqual(410);
      expect(empty.height / empty.width).toBeGreaterThanOrEqual(0.75);

      await scan("direct.html", "Direct video fixture");
      const found = await popupDimensions();
      expect(found.width).toBe(empty.width);
      expect(found.height / found.width).toBeLessThanOrEqual(1.25);
    });

    test("downloads dynamic, extensionless, and authenticated direct URLs", async () => {
      await scan("dynamic.html", "Dynamic video fixture");
      await expect(popup.locator("body")).not.toContainText("fixture-secret");
      await downloadAndVerify("Download sample.mp4", expectedHashes.mp4);

      await scan("extensionless.html", "Extensionless video fixture");
      await expect(popup.locator("body")).not.toContainText("fixture-secret");
      await downloadAndVerify("Download no-extension", expectedHashes.mp4);

      await context.addCookies([
        {
          name: "fixture_auth",
          value: "allowed",
          domain: "127.0.0.1",
          path: "/",
        },
      ]);
      await scan("protected.html", "Cookie protected fixture");
      await downloadAndVerify("Download sample.mp4", expectedHashes.mp4);
    });

    test("shows blob, HLS, and DASH as unsupported without creating downloads", async () => {
      const before = await latestDownload(popup);
      await scan("blob.html", "Streaming source found");
      await expect(
        popup.getByText("Page-managed blob videos are not supported."),
      ).toBeVisible();
      await expect(
        popup.getByRole("button", { name: /^Download / }),
      ).toHaveCount(0);

      await scan("streams.html", "Streaming source found");
      await expect(
        popup.getByText("HLS streams are not supported."),
      ).toBeVisible();
      await expect(
        popup.getByText("DASH streams are not supported."),
      ).toBeVisible();
      await expect(
        popup.getByRole("button", { name: /^Download / }),
      ).toHaveCount(0);
      expect((await latestDownload(popup))?.id).toBe(before?.id);
    });

    test("ignores segment traffic and a cross-origin iframe", async () => {
      await scan("segments.html", "No direct videos found");
      await expect(
        popup.getByRole("button", { name: /^Download / }),
      ).toHaveCount(0);

      await scan("iframe.html", "No direct videos found");
      await expect(
        popup.getByRole("button", { name: /^Download / }),
      ).toHaveCount(0);
      expect(await fixture.locator("[data-video-downloader]").count()).toBe(0);
    });

    test("passes accessibility, keyboard, reduced-motion, and text-scaling checks", async ({
      browserName: _browserName,
    }, testInfo) => {
      await scan("direct.html", "Direct video fixture");
      const accessibility = await new AxeBuilder({ page: popup }).analyze();
      expect(accessibility.violations).toEqual([]);

      await popup.getByRole("button", { name: "Scan again" }).focus();
      await expect(
        popup.getByRole("button", { name: "Scan again" }),
      ).toBeFocused();
      await popup.keyboard.press("Tab");
      await expect(
        popup.getByRole("button", { name: "Download sample.mp4" }),
      ).toBeFocused();

      await popup.emulateMedia({ reducedMotion: "reduce" });
      await fixture.bringToFront();
      await popup.reload();
      await expect(
        popup.getByRole("heading", { name: "Direct video fixture" }),
      ).toBeVisible();
      expect(await popup.locator(".spinner").count()).toBe(0);

      await popup.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      expect(
        await popup.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await popup.screenshot({
        path: testInfo.outputPath("popup-200-percent.png"),
      });
    });

    test("uses only a temporary test host grant in the E2E copy", async () => {
      const productionManifest = JSON.parse(
        await readFile(join(productionExtensionPath, "manifest.json"), "utf8"),
      ) as Record<string, unknown>;
      const testManifest = JSON.parse(
        await readFile(join(extensionPath, "manifest.json"), "utf8"),
      ) as Record<string, unknown>;

      expect(productionManifest).not.toHaveProperty("host_permissions");
      expect(testManifest.host_permissions).toEqual(["http://127.0.0.1/*"]);
      expect(basename(extensionPath)).toBe("extension");
    });
  });
