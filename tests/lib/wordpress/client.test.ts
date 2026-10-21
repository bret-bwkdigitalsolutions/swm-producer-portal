import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock server-only to avoid import error in test env
vi.mock("server-only", () => ({}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Set env vars before import
process.env.WP_API_URL = "https://example.com/wp-json/wp/v2";
process.env.WP_APP_USER = "testuser";
process.env.WP_APP_PASSWORD = "testpass";

import {
  getShows,
  getShow,
  getTaxonomyTerms,
  uploadMedia,
  createPost,
  updatePost,
  findEpisodeByTitleOrSlug,
  wpAuthorizationHeader,
  WP_BLOCKED_RETRY_DELAY_MS,
} from "@/lib/wordpress/client";
import {
  WpApiError,
  WpConfigError,
  WordPressBlockedError,
} from "@/lib/wordpress/types";

function headerLookup(contentType: string) {
  return {
    get: (name: string) =>
      name.toLowerCase() === "content-type" ? contentType : null,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headerLookup("application/json; charset=UTF-8"),
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  };
}

function htmlResponse(
  body: string,
  status = 200,
  contentType = "text/html; charset=UTF-8"
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headerLookup(contentType),
    text: () => Promise.resolve(body),
    json: () =>
      Promise.reject(new SyntaxError("Unexpected token < in JSON at position 0")),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("WordPress client", () => {
  it("builds correct auth header", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    await getShows();

    const expectedAuth =
      "Basic " + Buffer.from("testuser:testpass").toString("base64");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/swm_show"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expectedAuth,
        }),
      })
    );
  });

  it("getShows returns parsed show array", async () => {
    const mockShows = [
      { id: 1, title: { rendered: "Show One" }, slug: "show-one" },
      { id: 2, title: { rendered: "Show Two" }, slug: "show-two" },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse(mockShows));

    const shows = await getShows();
    expect(shows).toHaveLength(2);
    expect(shows[0].title.rendered).toBe("Show One");
  });

  it("getShow fetches a single show by ID", async () => {
    const mockShow = { id: 5, title: { rendered: "My Show" } };
    mockFetch.mockResolvedValueOnce(jsonResponse(mockShow));

    const show = await getShow(5);
    expect(show.id).toBe(5);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/swm_show/5"),
      expect.any(Object)
    );
  });

  it("getTaxonomyTerms fetches terms", async () => {
    const mockTerms = [{ id: 1, name: "Series A", slug: "series-a", count: 3 }];
    mockFetch.mockResolvedValueOnce(jsonResponse(mockTerms));

    const terms = await getTaxonomyTerms("swm_case_series");
    expect(terms).toHaveLength(1);
    expect(terms[0].name).toBe("Series A");
  });

  it("throws WpApiError on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    });

    await expect(getShows()).rejects.toThrow(WpApiError);
    await expect(getShows()).rejects.toThrow(); // also just throws
  });

  it("createPost sends correct payload with portal metadata", async () => {
    const mockPost = { id: 10, title: { rendered: "Test" }, link: "/test" };
    mockFetch.mockResolvedValueOnce(jsonResponse(mockPost));

    const result = await createPost("review", {
      title: "Movie Review",
      status: "publish",
      meta: { _swm_poster_url: "https://example.com/poster.jpg" },
    });

    expect(result.id).toBe(10);
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.meta._swm_portal_submission).toBe(true);
    expect(callBody.meta._swm_poster_url).toBe(
      "https://example.com/poster.jpg"
    );
  });

  it("labels missing WordPress credentials as a config error and does not retry", async () => {
    const user = process.env.WP_APP_USER;
    const password = process.env.WP_APP_PASSWORD;
    delete process.env.WP_APP_USER;
    delete process.env.WP_APP_PASSWORD;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const thrown = await getShows().then(
        () => null,
        (error: unknown) => error
      );
      expect(thrown).toBeInstanceOf(WpConfigError);
      expect((thrown as Error).message).toMatch(/WP API config error/);
      expect((thrown as Error).message).not.toMatch(/network error/);
      expect(mockFetch).not.toHaveBeenCalled();
      const attempts = errorSpy.mock.calls.filter((call) =>
        String(call[0]).includes("attempt")
      );
      expect(attempts).toHaveLength(1);
    } finally {
      process.env.WP_APP_USER = user;
      process.env.WP_APP_PASSWORD = password;
      errorSpy.mockRestore();
    }
  });

  it("throws when WordPress app credentials are unset", () => {
    const user = process.env.WP_APP_USER;
    const password = process.env.WP_APP_PASSWORD;
    try {
      delete process.env.WP_APP_USER;
      delete process.env.WP_APP_PASSWORD;
      expect(() => wpAuthorizationHeader()).toThrow(
        /WP_APP_USER and WP_APP_PASSWORD/
      );

      process.env.WP_APP_USER = " ";
      process.env.WP_APP_PASSWORD = password;
      expect(() => wpAuthorizationHeader()).toThrow(
        /WP_APP_USER and WP_APP_PASSWORD/
      );
    } finally {
      process.env.WP_APP_USER = user;
      process.env.WP_APP_PASSWORD = password;
    }
  });

  it("uploadMedia sends file as FormData", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ id: 42, source_url: "https://example.com/img.jpg" }),
    });

    const file = new File(["data"], "test.jpg", { type: "image/jpeg" });
    const result = await uploadMedia(file);

    expect(result.id).toBe(42);
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    expect(mockFetch.mock.calls[0][1].body).toBeInstanceOf(FormData);
  });

  it("does not retry a non-HTML write failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: headerLookup("text/plain"),
      text: () => Promise.resolve("unavailable"),
    });

    await expect(
      createPost("review", { title: "Movie Review", status: "draft" })
    ).rejects.toBeInstanceOf(WpApiError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("HTML bot-check responses", () => {
  async function blockedError(): Promise<WordPressBlockedError> {
    const error = await getShows().then(
      () => null,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(WordPressBlockedError);
    return error as WordPressBlockedError;
  }

  it("throws WordPressBlockedError for an HTML content type before parsing JSON", async () => {
    vi.useFakeTimers();
    const body = "Checking your browser" + "x".repeat(250);
    mockFetch.mockResolvedValue(htmlResponse(body, 200));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const pending = blockedError();
      await vi.advanceTimersByTimeAsync(WP_BLOCKED_RETRY_DELAY_MS);
      const error = await pending;

      expect(error.status).toBe(200);
      expect(error.body).toBe(body.slice(0, 200));
      expect(error.body).toHaveLength(200);
      expect(error.message).toContain("HTTP 200");
      expect(error.message).toContain(body.slice(0, 200));
      expect(error.message).not.toContain(body.slice(0, 201));
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("attempt 3/3"))).toBe(
        false
      );
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("treats a leading '<' as HTML even when the content type is JSON", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(
      htmlResponse("\n\n<html><title>Just a moment</title>", 200, "application/json")
    );

    try {
      const pending = blockedError();
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(WP_BLOCKED_RETRY_DELAY_MS - 1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      const error = await pending;
      expect(error.body.startsWith("\n\n<html>")).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a blocked read once after the block delay and then accepts JSON", async () => {
    vi.useFakeTimers();
    const shows = [{ id: 1, title: { rendered: "Show One" }, slug: "show-one" }];
    mockFetch
      .mockResolvedValueOnce(htmlResponse("<!DOCTYPE html><html>bot</html>", 200))
      .mockResolvedValueOnce(jsonResponse(shows));

    try {
      const pending = getShows();
      await vi.advanceTimersByTimeAsync(WP_BLOCKED_RETRY_DELAY_MS);
      await expect(pending).resolves.toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send an HTML-prefixed 200 on POST again", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(
      htmlResponse(
        '<br />\n<b>Notice</b>: Undefined index\n{"id":10,"title":{"rendered":"Movie Review"}}',
        200,
        "application/json"
      )
    );

    try {
      const pending = createPost("episode", {
        title: "Movie Review",
        status: "publish",
      });
      const settled = expect(pending).rejects.toMatchObject({
        name: "WordPressBlockedError",
        status: 200,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(WP_BLOCKED_RETRY_DELAY_MS + 1_000);
      await settled;
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a non-2xx HTML challenge once on GET and not on POST", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(htmlResponse("<html>challenge</html>", 403));

    try {
      const read = getShows().then(
        () => null,
        (error: unknown) => error
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(WP_BLOCKED_RETRY_DELAY_MS);
      const readError = await read;
      expect(readError).toBeInstanceOf(WordPressBlockedError);
      expect((readError as WordPressBlockedError).status).toBe(403);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      mockFetch.mockClear();
      const write = createPost("episode", {
        title: "Movie Review",
        status: "publish",
      });
      const writeSettled = expect(write).rejects.toBeInstanceOf(WordPressBlockedError);
      await vi.advanceTimersByTimeAsync(WP_BLOCKED_RETRY_DELAY_MS + 1_000);
      await writeSettled;
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still quick-retries a transient server error that is not HTML", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      headers: headerLookup("text/plain"),
      text: () => Promise.resolve("unavailable"),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const pending = getShows().then(
        () => null,
        (error: unknown) => error
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(500);
      const error = await pending;
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(error).toBeInstanceOf(WpApiError);
      expect(error).not.toBeInstanceOf(WordPressBlockedError);
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("findEpisodeByTitleOrSlug", () => {
  const jobStartedAt = "2026-10-21T18:00:00.000Z";
  const onThisJob = "2026-10-21T18:00:05";
  const olderEpisode = "2020-01-01T00:00:00";

  function episode(overrides: Record<string, unknown> = {}) {
    return {
      id: 9,
      slug: "tom-jerry",
      link: "https://example.com/tom-jerry",
      date_gmt: onThisJob,
      title: { rendered: "Tom & Jerry" },
      meta: { parent_show_id: 42 },
      ...overrides,
    };
  }

  function expectNoMetaQuery() {
    for (const call of mockFetch.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toContain("meta_key=");
      expect(url).not.toContain("meta_value=");
      expect(url).toContain("date_gmt");
    }
  }

  it("matches a same-show episode by slug without a title search", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        episode({
          title: { rendered: "Something Else" },
        }),
      ])
    );

    const found = await findEpisodeByTitleOrSlug("Tom & Jerry", 42, { jobStartedAt });

    expect(found).toEqual({
      id: 9,
      slug: "tom-jerry",
      link: "https://example.com/tom-jerry",
      title: "Something Else",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("slug=tom-jerry");
    expect(url).toContain("status=any");
    expectNoMetaQuery();
  });

  it("falls through to an exact title match, including HTML entities", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse([
          episode({
            id: 3,
            slug: "other",
            link: "https://example.com/other",
            title: { rendered: "Tom &amp; Jerry" },
            meta: { parent_show_id: "42" },
          }),
        ])
      );

    const found = await findEpisodeByTitleOrSlug("tom & jerry", 42, { jobStartedAt });

    expect(found).toMatchObject({
      id: 3,
      title: "Tom & Jerry",
      link: "https://example.com/other",
    });
    expect(String(mockFetch.mock.calls[1][0])).toContain("search=tom%20%26%20jerry");
    expectNoMetaQuery();
  });

  it("skips another show, a partial title, and an older same-title episode", async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse([
          episode({
            id: 1,
            link: "https://example.com/a",
            meta: { parent_show_id: 99 },
          }),
        ])
      )
      .mockResolvedValueOnce(
        jsonResponse([
          episode({
            id: 2,
            slug: "tom-jerry-live",
            link: "https://example.com/b",
            title: { rendered: "Tom &amp; Jerry Live" },
          }),
          episode({
            id: 8,
            slug: "tom-jerry-old",
            link: "https://example.com/old",
            date_gmt: olderEpisode,
          }),
          episode({
            id: 4,
            slug: "tom-jerry-3",
            link: "https://example.com/c",
          }),
        ])
      );

    await expect(
      findEpisodeByTitleOrSlug("Tom & Jerry", 42, { jobStartedAt })
    ).resolves.toMatchObject({
      id: 4,
      link: "https://example.com/c",
    });
  });

  it("returns null when neither the slug nor the title exists", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse([
          episode({
            id: 2,
            slug: "unrelated",
            link: "https://example.com/b",
            title: { rendered: "A different episode" },
          }),
        ])
      );

    await expect(
      findEpisodeByTitleOrSlug("Tom & Jerry", 42, { jobStartedAt })
    ).resolves.toBeNull();
  });

  it("treats a missing parent_show_id as no match", async () => {
    mockFetch.mockResolvedValue(jsonResponse([episode({ meta: {} })]));

    await expect(
      findEpisodeByTitleOrSlug("Tom & Jerry", 42, { jobStartedAt })
    ).resolves.toBeNull();
  });

  it("rejects an older episode unless the YouTube id or URL matches", async () => {
    const old = episode({ date_gmt: olderEpisode, date: olderEpisode });
    mockFetch.mockResolvedValue(jsonResponse([old]));

    await expect(
      findEpisodeByTitleOrSlug("Tom & Jerry", 42, { jobStartedAt })
    ).resolves.toBeNull();

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        episode({
          date_gmt: olderEpisode,
          meta: { parent_show_id: 42, youtube_video_id: "abcdefghijk" },
        }),
      ])
    );
    await expect(
      findEpisodeByTitleOrSlug("Tom & Jerry", 42, {
        jobStartedAt,
        youtubeVideoId: "abcdefghijk",
      })
    ).resolves.toMatchObject({ id: 9 });

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        episode({
          id: 11,
          date_gmt: olderEpisode,
          meta: {
            parent_show_id: 42,
            youtube_video_url: "https://youtu.be/abcdefghijk",
          },
        }),
      ])
    );
    await expect(
      findEpisodeByTitleOrSlug("Tom & Jerry", 42, {
        jobStartedAt,
        youtubeVideoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      })
    ).resolves.toMatchObject({ id: 11 });
  });

  it("accepts a post dated exactly when the job started", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([episode({ date_gmt: "2026-10-21T18:00:00" })])
    );

    await expect(
      findEpisodeByTitleOrSlug("Tom & Jerry", 42, { jobStartedAt })
    ).resolves.toMatchObject({ id: 9 });
  });

  it("does not match a same-title post that has no date and no YouTube identity", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([episode({ date_gmt: undefined, date: undefined })])
    );

    await expect(
      findEpisodeByTitleOrSlug("Tom & Jerry", 42, { jobStartedAt })
    ).resolves.toBeNull();
  });
});

describe("video worker WordPress proxy", () => {
  const previousWorker = process.env.VIDEO_WORKER;
  const previousUrl = process.env.NEXTAUTH_URL;
  const previousSecret = process.env.JOB_PROCESSING_SECRET;

  function enableWorker() {
    process.env.VIDEO_WORKER = "1";
    process.env.NEXTAUTH_URL = "https://portal.example.com";
    process.env.JOB_PROCESSING_SECRET = "job-secret";
  }

  function restoreWorkerEnv() {
    if (previousWorker === undefined) delete process.env.VIDEO_WORKER;
    else process.env.VIDEO_WORKER = previousWorker;
    if (previousUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.JOB_PROCESSING_SECRET;
    else process.env.JOB_PROCESSING_SECRET = previousSecret;
  }

  function portalResponse(result: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify({ ok: true, result })),
    };
  }

  afterEach(() => {
    restoreWorkerEnv();
  });

  it("forwards the job start and YouTube identity when looking up an episode", async () => {
    enableWorker();
    const started = new Date("2026-10-21T18:00:00.000Z");
    mockFetch.mockResolvedValueOnce(
      portalResponse({
        id: 9,
        link: "https://example.com/ep",
        slug: "episode-1",
        title: "Episode 1",
      })
    );

    const found = await findEpisodeByTitleOrSlug("Episode 1", 21, {
      jobStartedAt: started,
      youtubeVideoId: "abcdefghijk",
      youtubeVideoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    });

    expect(found?.id).toBe(9);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      op: "findEpisode",
      title: "Episode 1",
      wpShowId: 21,
      jobStartedAt: "2026-10-21T18:00:00.000Z",
      youtubeVideoId: "abcdefghijk",
      youtubeVideoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    });
    expect(mockFetch.mock.calls[0][0]).toBe("https://portal.example.com/api/jobs/wordpress");
  });

  it("sends show lookup to the portal with the job secret and does not call WordPress", async () => {
    enableWorker();
    mockFetch.mockResolvedValueOnce(
      portalResponse({ id: 21, title: { rendered: "Your Dark Companion" }, slug: "ydc" })
    );

    const show = await getShow(21);

    expect(show.id).toBe(21);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://portal.example.com/api/jobs/wordpress");
    expect(String(mockFetch.mock.calls[0][0])).not.toContain("/wp-json/");
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer job-secret");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ op: "getShow", id: 21 });
  });

  it("sends episode create and update through the portal", async () => {
    enableWorker();
    mockFetch
      .mockResolvedValueOnce(portalResponse({ id: 10, title: { rendered: "Test" }, link: "/test" }))
      .mockResolvedValueOnce(portalResponse({ id: 10, title: { rendered: "Test" }, link: "/test" }));

    await createPost("episode", { title: "Episode 1", status: "publish" });
    await updatePost("episode", 10, { title: "Episode 1 (updated)" });

    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
      op: "createPost",
      contentType: "episode",
      payload: { title: "Episode 1", status: "publish" },
    });
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toMatchObject({
      op: "updatePost",
      contentType: "episode",
      postId: 10,
    });
    expect(mockFetch.mock.calls[0][0]).toBe("https://portal.example.com/api/jobs/wordpress");
    expect(mockFetch.mock.calls[1][0]).toBe("https://portal.example.com/api/jobs/wordpress");
  });

  it("sends the featured image as base64 instead of posting it to WordPress", async () => {
    enableWorker();
    mockFetch.mockResolvedValueOnce(
      portalResponse({ id: 42, source_url: "https://example.com/img.jpg", title: { rendered: "img" } })
    );
    const file = new File(["image-bytes"], "thumb.jpg", { type: "image/jpeg" });

    const result = await uploadMedia(file, "thumb.jpg");

    expect(result.id).toBe(42);
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sent.op).toBe("uploadMedia");
    expect(sent.filename).toBe("thumb.jpg");
    expect(Buffer.from(sent.dataBase64, "base64").toString()).toBe("image-bytes");
    expect(mockFetch.mock.calls[0][1].body).not.toBeInstanceOf(FormData);
  });

  it("rebuilds a WordPressBlockedError from the portal response", async () => {
    enableWorker();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ok: false,
            error: {
              name: "WordPressBlockedError",
              message: "WordPress blocked the request (HTTP 200): <html>",
              status: 200,
              endpoint: "/swm_show/21",
              body: "<html>",
            },
          })
        ),
    });

    const error = await getShow(21).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(WordPressBlockedError);
    expect((error as WordPressBlockedError).status).toBe(200);
    expect((error as WordPressBlockedError).body).toBe("<html>");
  });

  it("does not call WordPress when the worker is missing the portal secret", async () => {
    enableWorker();
    delete process.env.JOB_PROCESSING_SECRET;

    await expect(getShow(21)).rejects.toThrow(/JOB_PROCESSING_SECRET/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
