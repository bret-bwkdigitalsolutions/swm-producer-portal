import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_OG_EMBED_DOMAINS,
  DEFAULT_OG_FOLDER_ID,
  OG_VIMEO_PRIVACY,
  ogEmbedDomains,
  ogFolderId,
  ogMediaUrl,
  scrubVimeoError,
  uploadOgVideoToVimeo,
} from "@/lib/platforms/vimeo";

const TOKEN = "super-secret-vimeo-token";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VIMEO_OG_ACCESS_TOKEN;
  delete process.env.VIMEO_OG_EMBED_DOMAINS;
  delete process.env.VIMEO_OG_FOLDER_ID;
});

describe("OG Vimeo settings", () => {
  it("hides the video from Vimeo and whitelists the site plus staging", () => {
    expect(OG_VIMEO_PRIVACY).toEqual({
      view: "disable",
      embed: "whitelist",
      download: false,
      add: false,
      comments: "nobody",
    });
    expect(ogEmbedDomains(undefined)).toEqual(DEFAULT_OG_EMBED_DOMAINS);
    expect(ogEmbedDomains(" StolenWaterMedia.com, https://staging.stolenwatermedia.com/og ")).toEqual([
      "stolenwatermedia.com",
      "staging.stolenwatermedia.com",
    ]);
    expect(ogFolderId(undefined)).toBe(DEFAULT_OG_FOLDER_ID);
    expect(ogFolderId("off")).toBeNull();
  });

  it("keeps a privacy hash in the media URL", () => {
    expect(
      ogMediaUrl(
        "1181373523",
        "https://vimeo.com/1181373523/072e7e7677",
        "https://player.vimeo.com/video/1181373523?h=072e7e7677"
      )
    ).toBe("https://vimeo.com/1181373523/072e7e7677");
    expect(ogMediaUrl("99", "https://vimeo.com/99")).toBe("https://vimeo.com/99");
  });

  it("strips tokens and signed URLs from errors", () => {
    expect(
      scrubVimeoError(
        "Bearer super-secret-vimeo-token failed at https://files.tus.vimeo.com/upload?access_token=super-secret-vimeo-token"
      )
    ).not.toContain("super-secret");
  });
});

describe("uploadOgVideoToVimeo", () => {
  it("creates a hidden video, uploads the file, and whitelists embed domains", async () => {
    process.env.VIMEO_OG_ACCESS_TOKEN = TOKEN;
    const dir = await mkdtemp(join(tmpdir(), "og-vimeo-"));
    const filePath = join(dir, "video.mp4");
    await writeFile(filePath, Buffer.from("video-bytes"));

    const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : undefined,
          auth: headers.get("authorization") ?? undefined,
        });
        if (url.endsWith("/me/videos") && init?.method === "POST") {
          return json({
            uri: "/videos/555",
            upload: { upload_link: "https://files.example/tus" },
          });
        }
        if (url === "https://files.example/tus") {
          return new Response(null, { status: 204 });
        }
        if (url.endsWith("/videos/555") && init?.method === "PATCH") {
          return json({});
        }
        if (url.includes("/privacy/domains/") && init?.method === "PUT") {
          return new Response(null, { status: 204 });
        }
        if (url.includes("/me/projects/") && init?.method === "PUT") {
          return new Response(null, { status: 204 });
        }
        if (url.includes("fields=")) {
          return json({
            uri: "/videos/555",
            link: "https://vimeo.com/555/abc123",
            player_embed_url: "https://player.vimeo.com/video/555?h=abc123",
            duration: 120,
            privacy: { view: "disable", embed: "whitelist" },
          });
        }
        return new Response("unexpected", { status: 500 });
      })
    );

    const created: string[] = [];
    const result = await uploadOgVideoToVimeo({
      title: "The OG #27",
      description: "Members only",
      videoFilePath: filePath,
      onVideoCreated: (videoId) => {
        created.push(videoId);
      },
    });

    expect(result).toEqual({
      videoId: "555",
      mediaUrl: "https://vimeo.com/555/abc123",
      thumbnailUrl: undefined,
      durationSeconds: 120,
    });
    expect(created).toEqual(["555"]);
    const create = calls.find((call) => call.url.endsWith("/me/videos"));
    expect(JSON.parse(create?.body ?? "{}").privacy).toEqual(OG_VIMEO_PRIVACY);
    expect(calls.some((call) => call.url.includes("/privacy/domains/stolenwatermedia.com"))).toBe(true);
    expect(calls.some((call) => call.url.includes("/privacy/domains/staging.stolenwatermedia.com"))).toBe(true);
    expect(calls.some((call) => call.url.includes(`/me/projects/${DEFAULT_OG_FOLDER_ID}/videos/555`))).toBe(true);
    const tusCall = calls.find((call) => call.url.includes("/tus"));
    expect(tusCall?.auth ?? "").not.toContain(TOKEN);

    await rm(dir, { recursive: true, force: true });
  });

  it("refuses to publish when Vimeo leaves the video public", async () => {
    process.env.VIMEO_OG_ACCESS_TOKEN = TOKEN;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const target = String(url);
        if (target.includes("upload.status")) {
          return json({ upload: { status: "complete" }, link: "https://vimeo.com/555" });
        }
        if (target.includes("privacy.view")) {
          return json({
            uri: "/videos/555",
            link: "https://vimeo.com/555",
            privacy: { view: "anybody", embed: "public" },
          });
        }
        return new Response(null, { status: 204 });
      })
    );

    await expect(
      uploadOgVideoToVimeo({
        title: "The OG #27",
        description: "Members only",
        existingVideoId: "555",
      })
    ).rejects.toThrow(/not hidden from Vimeo/);
  });

  it("scrubs a raw tus network error", async () => {
    process.env.VIMEO_OG_ACCESS_TOKEN = TOKEN;
    const dir = await mkdtemp(join(tmpdir(), "og-vimeo-"));
    const filePath = join(dir, "video.mp4");
    await writeFile(filePath, Buffer.from("video-bytes"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/me/videos") && init?.method === "POST") {
          return json({
            uri: "/videos/555",
            upload: {
              upload_link: `https://files.example/tus?access_token=${TOKEN}`,
            },
          });
        }
        throw new Error(
          `connect failed Bearer ${TOKEN} https://files.example/tus?access_token=${TOKEN}`
        );
      })
    );

    await expect(
      uploadOgVideoToVimeo({
        title: "The OG #27",
        description: "Members only",
        videoFilePath: filePath,
      })
    ).rejects.toThrow(/\[url\]/);
    await expect(
      uploadOgVideoToVimeo({
        title: "The OG #27",
        description: "Members only",
        videoFilePath: filePath,
      })
    ).rejects.not.toThrow(new RegExp(TOKEN));

    await rm(dir, { recursive: true, force: true });
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
