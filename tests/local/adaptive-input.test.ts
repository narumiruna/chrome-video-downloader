import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  validateLocalDashManifest,
  validateLocalTrackManifest,
} from "../../src/local/adaptive-input";

const cleanupPaths: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await realpath(
    await mkdtemp(join(tmpdir(), "adaptive-input-test-")),
  );
  cleanupPaths.push(path);
  return path;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createTrackFiles(root: string): Promise<void> {
  await mkdir(join(root, "video"));
  await mkdir(join(root, "audio"));
  await writeFile(join(root, "video", "init.m4s"), "video init");
  await writeFile(join(root, "video", "part-1.m4s"), "video one");
  await writeFile(join(root, "video", "part-2.m4s"), "video two");
  await writeFile(join(root, "audio", "init.m4s"), "audio init");
  await writeFile(join(root, "audio", "part-1.m4s"), "audio one");
}

function trackManifest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    video: {
      init: "video/init.m4s",
      segments: ["video/part-1.m4s", "video/part-2.m4s"],
    },
    audio: {
      init: "audio/init.m4s",
      segments: ["audio/part-1.m4s"],
    },
    ...overrides,
  };
}

describe("validateLocalTrackManifest", () => {
  test("accepts one ordered local video track and one local audio track", async () => {
    const root = await temporaryDirectory();
    await createTrackFiles(root);
    const manifest = join(root, "tracks.json");
    await writeFile(manifest, JSON.stringify(trackManifest()));

    await expect(validateLocalTrackManifest(manifest)).resolves.toEqual({
      manifestPath: manifest,
      tracks: [
        {
          initPath: join(root, "video", "init.m4s"),
          kind: "video",
          segmentPaths: [
            join(root, "video", "part-1.m4s"),
            join(root, "video", "part-2.m4s"),
          ],
          temporaryExtension: ".mp4",
        },
        {
          initPath: join(root, "audio", "init.m4s"),
          kind: "audio",
          segmentPaths: [join(root, "audio", "part-1.m4s")],
          temporaryExtension: ".mp4",
        },
      ],
    });
  });

  test.each([
    {
      name: "wrong version",
      value: trackManifest({ version: 2 }),
      code: "invalid-input",
    },
    {
      name: "unknown top-level field",
      value: trackManifest({ website: "https://example.com" }),
      code: "invalid-input",
    },
    {
      name: "remote reference",
      value: trackManifest({
        video: {
          init: "https://example.com/init.m4s",
          segments: ["video/part-1.m4s"],
        },
      }),
      code: "remote-input",
    },
    {
      name: "encoded traversal",
      value: trackManifest({
        video: {
          init: "%2e%2e/outside.m4s",
          segments: ["video/part-1.m4s"],
        },
      }),
      code: "path-escape",
    },
    {
      name: "empty fragment list",
      value: trackManifest({
        video: { init: "video/init.m4s", segments: [] },
      }),
      code: "invalid-input",
    },
    {
      name: "unknown track field",
      value: trackManifest({
        video: {
          init: "video/init.m4s",
          segments: ["video/part-1.m4s"],
          token: "secret",
        },
      }),
      code: "invalid-input",
    },
    {
      name: "null declared track",
      value: trackManifest({ video: null }),
      code: "invalid-input",
    },
    {
      name: "absolute reference",
      value: trackManifest({
        video: {
          init: "/tmp/init.m4s",
          segments: ["video/part-1.m4s"],
        },
      }),
      code: "remote-input",
    },
    {
      name: "query-bearing reference",
      value: trackManifest({
        video: {
          init: "video/init.m4s?token=secret",
          segments: ["video/part-1.m4s"],
        },
      }),
      code: "remote-input",
    },
    {
      name: "control-character reference",
      value: trackManifest({
        video: {
          init: "video/init.m4s\u0000",
          segments: ["video/part-1.m4s"],
        },
      }),
      code: "invalid-input",
    },
  ])("rejects $name", async ({ value, code }) => {
    const root = await temporaryDirectory();
    await createTrackFiles(root);
    const manifest = join(root, "tracks.json");
    await writeFile(manifest, JSON.stringify(value));

    await expect(validateLocalTrackManifest(manifest)).rejects.toMatchObject({
      code,
    });
  });

  test("rejects encrypted fragmented-media initialization data", async () => {
    const root = await temporaryDirectory();
    await createTrackFiles(root);
    await writeFile(
      join(root, "video", "init.m4s"),
      Buffer.from("00000000pssh00000000tenc", "ascii"),
    );
    const manifest = join(root, "tracks.json");
    await writeFile(manifest, JSON.stringify(trackManifest()));

    await expect(validateLocalTrackManifest(manifest)).rejects.toMatchObject({
      code: "encrypted-input",
    });
  });

  test("rejects malformed JSON and a missing referenced file", async () => {
    const root = await temporaryDirectory();
    await createTrackFiles(root);
    const manifest = join(root, "tracks.json");
    await writeFile(manifest, "{");
    await expect(validateLocalTrackManifest(manifest)).rejects.toMatchObject({
      code: "invalid-input",
    });

    await writeFile(
      manifest,
      JSON.stringify(
        trackManifest({
          audio: {
            init: "audio/init.m4s",
            segments: ["audio/missing.m4s"],
          },
        }),
      ),
    );
    await expect(validateLocalTrackManifest(manifest)).rejects.toMatchObject({
      code: "missing-input",
    });
  });

  test("rejects oversized, excessive, directory, and nested media inputs", async () => {
    const root = await temporaryDirectory();
    await createTrackFiles(root);
    const manifest = join(root, "tracks.json");

    await writeFile(manifest, " ".repeat(1_048_577));
    await expect(validateLocalTrackManifest(manifest)).rejects.toMatchObject({
      code: "invalid-input",
    });

    await writeFile(
      manifest,
      JSON.stringify(
        trackManifest({
          video: {
            init: "video/init.m4s",
            segments: Array.from({ length: 10_001 }, () => "video/part-1.m4s"),
          },
        }),
      ),
    );
    await expect(validateLocalTrackManifest(manifest)).rejects.toMatchObject({
      code: "invalid-input",
    });

    await writeFile(
      manifest,
      JSON.stringify(
        trackManifest({
          video: {
            init: "video/init.m4s",
            segments: ["video"],
          },
        }),
      ),
    );
    await expect(validateLocalTrackManifest(manifest)).rejects.toMatchObject({
      code: "invalid-input",
    });

    await writeFile(join(root, "video", "nested.m4s"), "#EXTM3U\nremote.ts");
    await writeFile(
      manifest,
      JSON.stringify(
        trackManifest({
          video: {
            init: "video/init.m4s",
            segments: ["video/nested.m4s"],
          },
        }),
      ),
    );
    await expect(validateLocalTrackManifest(manifest)).rejects.toMatchObject({
      code: "invalid-input",
    });
  });

  test("rejects a media symlink that escapes the manifest directory", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await createTrackFiles(root);
    await writeFile(join(outside, "outside.m4s"), "outside");
    await symlink(
      join(outside, "outside.m4s"),
      join(root, "video", "link.m4s"),
    );
    const manifest = join(root, "tracks.json");
    await writeFile(
      manifest,
      JSON.stringify(
        trackManifest({
          video: {
            init: "video/init.m4s",
            segments: ["video/link.m4s"],
          },
        }),
      ),
    );

    await expect(validateLocalTrackManifest(manifest)).rejects.toMatchObject({
      code: "path-escape",
    });
  });
});

function templateDash(extra = ""): string {
  return `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  ${extra}
  <Period>
    <AdaptationSet contentType="video">
      <Representation id="video-main" mimeType="video/mp4">
        <SegmentTemplate initialization="video/init-$RepresentationID$.m4s" media="video/chunk-$RepresentationID$-$Number%02d$.m4s" startNumber="1">
          <SegmentTimeline><S t="0" d="10" r="1"/></SegmentTimeline>
        </SegmentTemplate>
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio">
      <Representation id="audio-main" mimeType="audio/mp4">
        <SegmentTemplate initialization="audio/init-$RepresentationID$.m4s" media="audio/chunk-$RepresentationID$-$Time$.m4s">
          <SegmentTimeline><S t="0" d="10"/><S d="10"/></SegmentTimeline>
        </SegmentTemplate>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
}

async function createDashFiles(root: string): Promise<void> {
  await mkdir(join(root, "video"));
  await mkdir(join(root, "audio"));
  for (const file of [
    "video/init-video-main.m4s",
    "video/chunk-video-main-01.m4s",
    "video/chunk-video-main-02.m4s",
    "audio/init-audio-main.m4s",
    "audio/chunk-audio-main-0.m4s",
    "audio/chunk-audio-main-10.m4s",
  ]) {
    await writeFile(join(root, file), file);
  }
}

describe("validateLocalDashManifest", () => {
  test("expands a finite local SegmentTimeline into ordered tracks", async () => {
    const root = await temporaryDirectory();
    await createDashFiles(root);
    const manifest = join(root, "presentation.mpd");
    await writeFile(manifest, templateDash());

    const result = await validateLocalDashManifest(manifest, {});

    expect(result.manifestPath).toBe(manifest);
    expect(result.tracks).toEqual([
      {
        initPath: join(root, "video", "init-video-main.m4s"),
        kind: "video",
        segmentPaths: [
          join(root, "video", "chunk-video-main-01.m4s"),
          join(root, "video", "chunk-video-main-02.m4s"),
        ],
        temporaryExtension: ".mp4",
      },
      {
        initPath: join(root, "audio", "init-audio-main.m4s"),
        kind: "audio",
        segmentPaths: [
          join(root, "audio", "chunk-audio-main-0.m4s"),
          join(root, "audio", "chunk-audio-main-10.m4s"),
        ],
        temporaryExtension: ".mp4",
      },
    ]);
  });

  test("accepts explicit local SegmentList references", async () => {
    const root = await temporaryDirectory();
    await createTrackFiles(root);
    const manifest = join(root, "presentation.mpd");
    await writeFile(
      manifest,
      `<MPD type="static"><Period><AdaptationSet contentType="video"><Representation id="v" mimeType="video/mp4"><SegmentList><Initialization sourceURL="video/init.m4s"/><SegmentURL media="video/part-1.m4s"/><SegmentURL media="video/part-2.m4s"/></SegmentList></Representation></AdaptationSet><AdaptationSet contentType="audio"><Representation id="a" mimeType="audio/mp4"><SegmentList><Initialization sourceURL="audio/init.m4s"/><SegmentURL media="audio/part-1.m4s"/></SegmentList></Representation></AdaptationSet></Period></MPD>`,
    );

    await expect(
      validateLocalDashManifest(manifest, {}),
    ).resolves.toMatchObject({
      tracks: [
        {
          kind: "video",
          segmentPaths: [
            join(root, "video", "part-1.m4s"),
            join(root, "video", "part-2.m4s"),
          ],
        },
        { kind: "audio", segmentPaths: [join(root, "audio", "part-1.m4s")] },
      ],
    });
  });

  test("requires explicit selection when a track has multiple representations", async () => {
    const root = await temporaryDirectory();
    await createDashFiles(root);
    await writeFile(join(root, "video", "init-video-low.m4s"), "init");
    await writeFile(join(root, "video", "chunk-video-low-01.m4s"), "one");
    await writeFile(join(root, "video", "chunk-video-low-02.m4s"), "two");
    const manifest = join(root, "presentation.mpd");
    const duplicate = `<Representation id="video-low" mimeType="video/mp4"><SegmentTemplate initialization="video/init-$RepresentationID$.m4s" media="video/chunk-$RepresentationID$-$Number%02d$.m4s" startNumber="1"><SegmentTimeline><S d="10" r="1"/></SegmentTimeline></SegmentTemplate></Representation>`;
    await writeFile(
      manifest,
      templateDash().replace(
        '<Representation id="video-main"',
        `${duplicate}<Representation id="video-main"`,
      ),
    );

    await expect(validateLocalDashManifest(manifest, {})).rejects.toMatchObject(
      {
        code: "ambiguous-input",
      },
    );
    await expect(
      validateLocalDashManifest(manifest, { videoRepresentation: "video-low" }),
    ).resolves.toMatchObject({
      tracks: [
        { initPath: join(root, "video", "init-video-low.m4s") },
        { kind: "audio" },
      ],
    });
  });

  test.each([
    {
      name: "dynamic MPD",
      mutate: (xml: string) => xml.replace('type="static"', 'type="dynamic"'),
      code: "live-input",
    },
    {
      name: "multiple Periods",
      mutate: (xml: string) => xml.replace("</MPD>", "<Period/></MPD>"),
      code: "invalid-input",
    },
    {
      name: "ContentProtection",
      mutate: (xml: string) =>
        xml.replace("<Period>", "<Period><ContentProtection/>"),
      code: "encrypted-input",
    },
    {
      name: "Location",
      mutate: (xml: string) =>
        xml.replace("<Period>", "<Location>remote.mpd</Location><Period>"),
      code: "remote-input",
    },
    {
      name: "UTCTiming",
      mutate: (xml: string) =>
        xml.replace(
          "<Period>",
          '<UTCTiming value="https://example.com"/><Period>',
        ),
      code: "remote-input",
    },
    {
      name: "XLink",
      mutate: (xml: string) =>
        xml.replace("<Period>", '<Period xlink:href="remote.mpd">'),
      code: "remote-input",
    },
    {
      name: "XLink namespace alias",
      mutate: (xml: string) =>
        xml
          .replace(
            'xmlns="urn:mpeg:dash:schema:mpd:2011"',
            'xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:remote="http://www.w3.org/1999/xlink"',
          )
          .replace("<Period>", '<Period remote:href="remote.mpd">'),
      code: "remote-input",
    },
    {
      name: "negative repeat",
      mutate: (xml: string) => xml.replace('r="1"', 'r="-1"'),
      code: "invalid-input",
    },
    {
      name: "timeline-free template",
      mutate: (xml: string) =>
        xml.replace(/<SegmentTimeline>.*?<\/SegmentTimeline>/s, ""),
      code: "invalid-input",
    },
    {
      name: "unsupported template token",
      mutate: (xml: string) => xml.replace("$Number%02d$", "$Bandwidth$"),
      code: "invalid-input",
    },
    {
      name: "remote media",
      mutate: (xml: string) =>
        xml.replace("video/chunk-", "https://example.com/chunk-"),
      code: "remote-input",
    },
    {
      name: "SegmentBase",
      mutate: (xml: string) =>
        xml.replace(
          /<SegmentTemplate.*?<\/SegmentTemplate>/s,
          "<SegmentBase/>",
        ),
      code: "invalid-input",
    },
    {
      name: "inherited adaptation segment template",
      mutate: (xml: string) =>
        xml.replace(
          '<AdaptationSet contentType="video">',
          '<AdaptationSet contentType="video"><SegmentTemplate initialization="video/init-$RepresentationID$.m4s" media="video/chunk-$RepresentationID$-$Number%02d$.m4s"><SegmentTimeline><S d="10" r="1"/></SegmentTimeline></SegmentTemplate>',
        ),
      code: "invalid-input",
    },
    {
      name: "inherited Period segment template",
      mutate: (xml: string) =>
        xml.replace(
          "<Period>",
          '<Period><SegmentTemplate initialization="video/init-$RepresentationID$.m4s" media="video/chunk-$RepresentationID$-$Number%02d$.m4s"><SegmentTimeline><S d="10" r="1"/></SegmentTimeline></SegmentTemplate>',
        ),
      code: "invalid-input",
    },
    {
      name: "byte-range segment list",
      mutate: (xml: string) =>
        xml.replace(
          /<SegmentTemplate.*?<\/SegmentTemplate>/s,
          '<SegmentList><Initialization sourceURL="video/init-video-main.m4s" range="0-10"/><SegmentURL media="video/chunk-video-main-01.m4s" mediaRange="11-20"/></SegmentList>',
        ),
      code: "invalid-input",
    },
  ])("rejects $name", async ({ mutate, code }) => {
    const root = await temporaryDirectory();
    await createDashFiles(root);
    const manifest = join(root, "presentation.mpd");
    await writeFile(manifest, mutate(templateDash()));

    await expect(validateLocalDashManifest(manifest, {})).rejects.toMatchObject(
      {
        code,
      },
    );
  });

  test("rejects an unknown representation and an oversized MPD", async () => {
    const root = await temporaryDirectory();
    await createDashFiles(root);
    const manifest = join(root, "presentation.mpd");
    await writeFile(manifest, templateDash());
    await expect(
      validateLocalDashManifest(manifest, {
        videoRepresentation: "missing-video",
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });

    await writeFile(manifest, `<MPD>${" ".repeat(1_048_577)}</MPD>`);
    await expect(validateLocalDashManifest(manifest, {})).rejects.toMatchObject(
      {
        code: "invalid-input",
      },
    );
  });

  test("rejects DTDs, entities, malformed XML, and missing representations", async () => {
    const root = await temporaryDirectory();
    const manifest = join(root, "presentation.mpd");
    for (const content of [
      '<!DOCTYPE MPD SYSTEM "https://example.com/evil"><MPD/>',
      '<!DOCTYPE MPD [<!ENTITY x "value">]><MPD>&x;</MPD>',
      "<MPD>",
      '<MPD type="static"><Period/></MPD>',
    ]) {
      await writeFile(manifest, content);
      await expect(
        validateLocalDashManifest(manifest, {}),
      ).rejects.toMatchObject({
        code: "invalid-input",
      });
    }
  });
});
