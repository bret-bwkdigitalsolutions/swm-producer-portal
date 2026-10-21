import { describe, it, expect, vi, beforeEach } from "vitest";

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

  it("retries a blocked write once and does not quick-retry it", async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(htmlResponse("<html>challenge</html>", 200))
      .mockResolvedValueOnce(
        jsonResponse({ id: 10, title: { rendered: "Test" }, link: "/test" })
      );

    try {
      const pending = createPost("review", {
        title: "Movie Review",
        status: "publish",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(WP_BLOCKED_RETRY_DELAY_MS);
      const result = await pending;
      expect(result.id).toBe(10);
      expect(mockFetch).toHaveBeenCalledTimes(2);
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
  it("matches a same-show episode by slug without a title search", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 9,
          slug: "tom-jerry",
          link: "https://example.com/tom-jerry",
          title: { rendered: "Something Else" },
          meta: { parent_show_id: 42 },
        },
      ])
    );

    const found = await findEpisodeByTitleOrSlug("Tom & Jerry", 42);

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
    expect(url).toContain("meta_value=42");
  });

  it("falls through to an exact title match, including HTML entities", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 3,
            slug: "other",
            link: "https://example.com/other",
            title: { rendered: "Tom &amp; Jerry" },
            meta: { parent_show_id: "42" },
          },
        ])
      );

    const found = await findEpisodeByTitleOrSlug("tom & jerry", 42);

    expect(found).toMatchObject({
      id: 3,
      title: "Tom & Jerry",
      link: "https://example.com/other",
    });
    expect(String(mockFetch.mock.calls[1][0])).toContain("search=tom%20%26%20jerry");
  });

  it("skips another show and ignores a partial title", async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 1,
            slug: "tom-jerry",
            link: "https://example.com/a",
            title: { rendered: "Tom & Jerry" },
            meta: { parent_show_id: 99 },
          },
        ])
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 2,
            slug: "tom-jerry-live",
            link: "https://example.com/b",
            title: { rendered: "Tom &amp; Jerry Live" },
            meta: { parent_show_id: 42 },
          },
          {
            id: 4,
            slug: "tom-jerry-3",
            link: "https://example.com/c",
            title: { rendered: "Tom & Jerry" },
            meta: { parent_show_id: 42 },
          },
        ])
      );

    await expect(findEpisodeByTitleOrSlug("Tom & Jerry", 42)).resolves.toMatchObject({
      id: 4,
      link: "https://example.com/c",
    });
  });

  it("returns null when neither the slug nor the title exists", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 2,
            slug: "unrelated",
            link: "https://example.com/b",
            title: { rendered: "A different episode" },
            meta: { parent_show_id: 42 },
          },
        ])
      );

    await expect(findEpisodeByTitleOrSlug("Tom & Jerry", 42)).resolves.toBeNull();
  });
});
