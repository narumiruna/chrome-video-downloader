import { describe, expect, test, vi } from "vitest";
import {
  type ChromeScanApi,
  isRestrictedPageUrl,
  scanActivePage,
} from "../../src/platform/chrome-tabs";

function apiWith(overrides: Partial<ChromeScanApi> = {}): ChromeScanApi {
  return {
    tabs: {
      query: vi
        .fn()
        .mockResolvedValue([
          { id: 7, title: "Fixture", url: "https://example.com/watch" },
        ]),
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue([
        {
          result: {
            candidates: [
              {
                sourceKind: "media-element",
                url: "https://cdn.example.com/video.mp4",
              },
            ],
            pageTitle: "Fixture",
            pageUrl: "https://example.com/watch",
          },
        },
      ]),
    },
    ...overrides,
  };
}

describe("isRestrictedPageUrl", () => {
  test.each([
    "chrome://extensions",
    "edge://settings",
    "devtools://devtools/bundled/inspector.html",
    "view-source:https://example.com",
    "file:///tmp/video.html",
    "https://chromewebstore.google.com/detail/example/id",
    "https://chrome.google.com/webstore/detail/example/id",
    "not a url",
  ])("identifies a page where script injection is unavailable", (url) => {
    expect(isRestrictedPageUrl(url)).toBe(true);
  });

  test("allows ordinary HTTP pages", () => {
    expect(isRestrictedPageUrl("https://example.com/watch")).toBe(false);
    expect(isRestrictedPageUrl("http://localhost:4173/direct.html")).toBe(
      false,
    );
  });
});

describe("scanActivePage", () => {
  test("injects the collector into the active top frame and validates its result", async () => {
    const api = apiWith();

    const result = await scanActivePage(api);

    expect(api.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
    expect(api.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 7 },
        world: "ISOLATED",
      }),
    );
    expect(result).toMatchObject({
      status: "success",
      pageTitle: "Fixture",
      candidates: [
        expect.objectContaining({
          support: { status: "downloadable" },
          url: "https://cdn.example.com/video.mp4",
        }),
      ],
    });
  });

  test("returns a restricted state without attempting injection", async () => {
    const api = apiWith({
      tabs: {
        query: vi
          .fn()
          .mockResolvedValue([
            { id: 9, title: "Extensions", url: "chrome://extensions" },
          ]),
      },
    });

    const result = await scanActivePage(api);

    expect(result).toEqual({ pageTitle: "Extensions", status: "restricted" });
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  });

  test("normalizes missing tabs and injection failures", async () => {
    const noTab = apiWith({
      tabs: { query: vi.fn().mockResolvedValue([]) },
    });
    const invalidTabId = apiWith({
      tabs: {
        query: vi
          .fn()
          .mockResolvedValue([
            { id: -1, title: "Invalid", url: "https://example.com" },
          ]),
      },
    });
    const failed = apiWith({
      scripting: {
        executeScript: vi
          .fn()
          .mockRejectedValue(new Error("secret URL ?token=value")),
      },
    });

    await expect(scanActivePage(noTab)).resolves.toEqual({
      code: "no-active-tab",
      status: "error",
    });
    await expect(scanActivePage(invalidTabId)).resolves.toEqual({
      code: "no-active-tab",
      status: "error",
    });
    await expect(scanActivePage(failed)).resolves.toEqual({
      code: "scan-failed",
      status: "error",
    });
  });

  test("rejects an absent script result", async () => {
    const api = apiWith({
      scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    });

    await expect(scanActivePage(api)).resolves.toEqual({
      code: "scan-failed",
      status: "error",
    });
  });
});
