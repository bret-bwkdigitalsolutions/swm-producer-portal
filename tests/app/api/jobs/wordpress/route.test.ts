import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mockGetShow = vi.fn();
const mockCreatePost = vi.fn();
const mockUpdatePost = vi.fn();
const mockFindEpisode = vi.fn();
const mockUploadMedia = vi.fn();
const mockRecentTitles = vi.fn();
const mockLatestNumbers = vi.fn();
const mockLiveCandidate = vi.fn();
const mockVerify = vi.fn();

vi.mock("@/lib/wordpress/client", () => ({
  getShow: (...args: unknown[]) => mockGetShow(...args),
  createPost: (...args: unknown[]) => mockCreatePost(...args),
  updatePost: (...args: unknown[]) => mockUpdatePost(...args),
  findEpisodeByTitleOrSlug: (...args: unknown[]) => mockFindEpisode(...args),
  uploadMedia: (...args: unknown[]) => mockUploadMedia(...args),
  getRecentEpisodeTitles: (...args: unknown[]) => mockRecentTitles(...args),
  getLatestEpisodeNumbers: (...args: unknown[]) => mockLatestNumbers(...args),
}));

vi.mock("@/lib/wordpress/live-candidate", () => ({
  lookupLiveStreamCandidate: (...args: unknown[]) => mockLiveCandidate(...args),
}));

vi.mock("@/lib/jobs/verify-distribution", () => ({
  websiteVerificationIssuesFromWordPress: (...args: unknown[]) => mockVerify(...args),
}));

import { POST } from "@/app/api/jobs/wordpress/route";
import { WordPressBlockedError } from "@/lib/wordpress/types";

const SECRET = "job-secret";

function request(body: unknown, authorization?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new NextRequest("https://portal.example.com/api/jobs/wordpress", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JOB_PROCESSING_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.JOB_PROCESSING_SECRET;
});

describe("POST /api/jobs/wordpress", () => {
  it("rejects a missing secret, a missing bearer, and a wrong bearer", async () => {
    delete process.env.JOB_PROCESSING_SECRET;
    const missing = await POST(request({ op: "getShow", id: 21 }, `Bearer ${SECRET}`));
    expect(missing.status).toBe(500);
    expect(mockGetShow).not.toHaveBeenCalled();

    process.env.JOB_PROCESSING_SECRET = SECRET;
    const noHeader = await POST(request({ op: "getShow", id: 21 }));
    expect(noHeader.status).toBe(401);

    const wrong = await POST(request({ op: "getShow", id: 21 }, "Bearer nope"));
    expect(wrong.status).toBe(401);
    expect(mockGetShow).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown operation", async () => {
    const response = await POST(request({ op: "deleteEverything" }, `Bearer ${SECRET}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown operation: deleteEverything" });
  });

  it("looks up a show, a live candidate, and an episode on behalf of the worker", async () => {
    mockGetShow.mockResolvedValue({ id: 21, title: { rendered: "YDC" } });
    mockLiveCandidate.mockResolvedValue({
      ok: true,
      candidate: { id: 55, title: "Live", youtube_id: "vid", date: "2026-05-20" },
    });
    mockFindEpisode.mockResolvedValue({
      id: 9,
      link: "https://example.com/ep",
      slug: "episode-1",
      title: "Episode 1",
    });

    const show = await POST(request({ op: "getShow", id: 21 }, `Bearer ${SECRET}`));
    expect(show.status).toBe(200);
    expect(await show.json()).toEqual({
      ok: true,
      result: { id: 21, title: { rendered: "YDC" } },
    });
    expect(mockGetShow).toHaveBeenCalledWith(21);

    const live = await POST(
      request(
        { op: "liveCandidate", wpShowId: 21, airDate: "2026-05-20", youtubeId: "vid" },
        `Bearer ${SECRET}`
      )
    );
    expect(live.status).toBe(200);
    expect(mockLiveCandidate).toHaveBeenCalledWith(21, "2026-05-20", "vid");

    const found = await POST(
      request({ op: "findEpisode", title: "Episode 1", wpShowId: 21 }, `Bearer ${SECRET}`)
    );
    expect((await found.json()).result.id).toBe(9);
    expect(mockFindEpisode).toHaveBeenCalledWith("Episode 1", 21, {
      jobStartedAt: null,
      youtubeVideoId: null,
      youtubeVideoUrl: null,
    });

    const foundWithIdentity = await POST(
      request(
        {
          op: "findEpisode",
          title: "Episode 1",
          wpShowId: 21,
          jobStartedAt: "2026-10-21T18:00:00.000Z",
          youtubeVideoId: "abcdefghijk",
          youtubeVideoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        },
        `Bearer ${SECRET}`
      )
    );
    expect((await foundWithIdentity.json()).result.id).toBe(9);
    expect(mockFindEpisode).toHaveBeenLastCalledWith("Episode 1", 21, {
      jobStartedAt: "2026-10-21T18:00:00.000Z",
      youtubeVideoId: "abcdefghijk",
      youtubeVideoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    });
  });

  it("reads recent titles and the latest episode numbers for analysis", async () => {
    mockRecentTitles.mockResolvedValue(["Last week"]);
    mockLatestNumbers.mockResolvedValue({ episodeNumber: 12, seasonNumber: 3 });

    const titles = await POST(
      request({ op: "recentEpisodeTitles", wpShowId: 21, count: 5 }, `Bearer ${SECRET}`)
    );
    expect(await titles.json()).toEqual({ ok: true, result: ["Last week"] });
    expect(mockRecentTitles).toHaveBeenCalledWith(21, 5);

    const numbers = await POST(
      request({ op: "latestEpisodeNumbers", wpShowId: 21 }, `Bearer ${SECRET}`)
    );
    expect((await numbers.json()).result).toEqual({ episodeNumber: 12, seasonNumber: 3 });
    expect(mockLatestNumbers).toHaveBeenCalledWith(21);
  });

  it("creates and updates an episode", async () => {
    mockCreatePost.mockResolvedValue({ id: 10, link: "/new" });
    mockUpdatePost.mockResolvedValue({ id: 10, link: "/edited" });

    const created = await POST(
      request(
        {
          op: "createPost",
          contentType: "episode",
          payload: { title: "Episode 1", status: "publish" },
        },
        `Bearer ${SECRET}`
      )
    );
    expect(created.status).toBe(200);
    expect(mockCreatePost).toHaveBeenCalledWith("episode", {
      title: "Episode 1",
      status: "publish",
    });

    const updated = await POST(
      request(
        {
          op: "updatePost",
          contentType: "episode",
          postId: 10,
          payload: { title: "Episode 1b" },
        },
        `Bearer ${SECRET}`
      )
    );
    expect(updated.status).toBe(200);
    expect(mockUpdatePost).toHaveBeenCalledWith("episode", 10, { title: "Episode 1b" });
  });

  it("rebuilds an uploaded file and forwards verification to WordPress", async () => {
    mockUploadMedia.mockImplementation(async (file: File) => ({
      id: 42,
      source_url: "https://example.com/img.jpg",
      bytes: await file.text(),
    }));
    mockVerify.mockResolvedValue([]);

    const uploaded = await POST(
      request(
        {
          op: "uploadMedia",
          filename: "thumb.jpg",
          contentType: "image/jpeg",
          dataBase64: Buffer.from("image-bytes").toString("base64"),
        },
        `Bearer ${SECRET}`
      )
    );
    expect(uploaded.status).toBe(200);
    expect((await uploaded.json()).result.bytes).toBe("image-bytes");

    const verified = await POST(
      request(
        {
          op: "verifyEpisode",
          tier: 2,
          postId: "55",
          wpShowId: 21,
          expectedTitle: "Episode 1",
          isLiveRecording: false,
          isPremium: true,
        },
        `Bearer ${SECRET}`
      )
    );
    expect(verified.status).toBe(200);
    expect(mockVerify).toHaveBeenCalledWith(2, "55", {
      jobId: "",
      wpShowId: 21,
      expectedTitle: "Episode 1",
      isLiveRecording: false,
      isPremium: true,
    });
  });

  it("returns a blocked WordPress error without treating it as a client bug", async () => {
    mockGetShow.mockRejectedValue(
      new WordPressBlockedError(200, "<html>bot</html>", "/swm_show/21")
    );
    const response = await POST(request({ op: "getShow", id: 21 }, `Bearer ${SECRET}`));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatchObject({
      name: "WordPressBlockedError",
      status: 200,
      body: "<html>bot</html>",
      endpoint: "/swm_show/21",
    });
  });
});
