import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics/credentials", () => ({
  getTransistorApiKey: vi.fn(async () => "transistor-key"),
  resolvePlatformId: vi.fn(async () => "11111"),
  parseTransistorShowId: (value: string) => {
    if (/^\d+$/.test(value)) return value;
    try {
      const url = new URL(value);
      const segments = url.pathname.split("/").filter(Boolean);
      return segments[segments.length - 1] || value;
    } catch {
      return value;
    }
  },
}));

vi.mock("@/lib/gcs", () => ({
  generateSignedDownloadUrl: vi.fn(async () => "https://storage.example/audio.mp3"),
}));

vi.mock("@/lib/platforms/bounded-upload", () => ({
  uploadFromRemote: vi.fn(async () => undefined),
}));

vi.mock("@/lib/image", () => ({
  prepareTransistorImageUrl: vi.fn(),
}));

import { TransistorCreatedError, uploadToTransistor } from "@/lib/platforms/transistor";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("uploadToTransistor show id", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function installFetch(shows?: Array<{ id: string; slug: string }>) {
    const posts: unknown[] = [];
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/episodes/authorize_upload")) {
        return json({
          data: {
            attributes: {
              upload_url: "https://s3.example/upload",
              content_url: "https://s3.example/audio.mp3",
            },
          },
        });
      }
      if (url.endsWith("/shows")) {
        return json({
          data: (shows ?? []).map((show) => ({
            id: show.id,
            attributes: { slug: show.slug },
          })),
        });
      }
      if (url.endsWith("/episodes") && init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return json({ data: { id: "ep-1", attributes: { share_url: "https://share.transistor.fm/s/ep-1" } } });
      }
      if (url.includes("/episodes/") && init?.method === "PATCH") {
        return json({ data: { id: "ep-1" } });
      }
      throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return { posts, urls, fetchMock };
  }

  it("sends a numeric override as show_id without listing shows", async () => {
    const { posts, urls } = installFetch();
    await uploadToTransistor({
      wpShowId: 21,
      title: "The OG",
      description: "Hour",
      gcsAudioPath: "uploads/og.mp3",
      transistorShowIdOverride: "44120",
    });
    expect(posts).toEqual([
      expect.objectContaining({ episode: expect.objectContaining({ show_id: "44120" }) }),
    ]);
    expect(urls.some((url) => url.endsWith("/shows"))).toBe(false);
  });

  it("resolves a slug override to the numeric show id before creating the episode", async () => {
    const { posts, urls } = installFetch([{ id: "44120", slug: "the-og" }]);
    await uploadToTransistor({
      wpShowId: 21,
      title: "The OG",
      description: "Hour",
      gcsAudioPath: "uploads/og.mp3",
      transistorShowIdOverride: "the-og",
    });
    expect(urls.some((url) => url.endsWith("/shows"))).toBe(true);
    expect(posts).toEqual([
      expect.objectContaining({ episode: expect.objectContaining({ show_id: "44120" }) }),
    ]);
  });

  it("keeps the created episode id when publish fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/episodes/authorize_upload")) {
        return json({
          data: { attributes: { upload_url: "https://s3.example/upload", content_url: "https://s3.example/a.mp3" } },
        });
      }
      if (url.endsWith("/episodes") && init?.method === "POST") {
        return json({ data: { id: "ep-kept", attributes: {} } });
      }
      if (init?.method === "PATCH") {
        return new Response("no", { status: 500 });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadToTransistor({
        wpShowId: 21,
        title: "The OG",
        description: "Hour",
        gcsAudioPath: "uploads/og.mp3",
        transistorShowIdOverride: "44120",
      })
    ).rejects.toBeInstanceOf(TransistorCreatedError);

    try {
      await uploadToTransistor({
        wpShowId: 21,
        title: "The OG",
        description: "Hour",
        gcsAudioPath: "uploads/og.mp3",
        transistorShowIdOverride: "44120",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(TransistorCreatedError);
      expect((error as TransistorCreatedError).episodeId).toBe("ep-kept");
    }
  });

  it("retries publish with PATCH and does not create another episode", async () => {
    const methods: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      if ((init?.method ?? "GET") === "PATCH") return json({ data: { id: "ep-kept" } });
      throw new Error("create should not run");
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await uploadToTransistor({
      wpShowId: 21,
      title: "The OG",
      description: "Hour",
      gcsAudioPath: "uploads/og.mp3",
      existingEpisodeId: "ep-kept",
    });
    expect(result.episodeId).toBe("ep-kept");
    expect(methods).toEqual(["PATCH"]);
  });
});
