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
  findEpisodeCreatedForShow,
  selectCreatedEpisode,
  wpAuthorizationHeader,
} from "@/lib/wordpress/client";
import { WpApiError } from "@/lib/wordpress/types";

beforeEach(() => {
  mockFetch.mockReset();
});

describe("WordPress client", () => {
  it("builds correct auth header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockShows),
    });

    const shows = await getShows();
    expect(shows).toHaveLength(2);
    expect(shows[0].title.rendered).toBe("Show One");
  });

  it("getShow fetches a single show by ID", async () => {
    const mockShow = { id: 5, title: { rendered: "My Show" } };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockShow),
    });

    const show = await getShow(5);
    expect(show.id).toBe(5);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/swm_show/5"),
      expect.any(Object)
    );
  });

  it("getTaxonomyTerms fetches terms", async () => {
    const mockTerms = [{ id: 1, name: "Series A", slug: "series-a", count: 3 }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTerms),
    });

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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPost),
    });

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

  it("findEpisodeCreatedForShow prefers the new post over the live post it replaces", async () => {
    const live = {
      id: 55,
      title: { rendered: "Friday Night Live" },
      link: "https://example.com/live",
      slug: "friday-night-live",
      meta: { parent_show_id: 22 },
    };
    const created = {
      id: 901,
      title: { rendered: "Friday Night Live" },
      link: "https://example.com/episode/friday-night-live-2",
      slug: "friday-night-live-2",
      meta: { parent_show_id: "22" },
    };
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes("slug=") ? [live] : [live, created]),
    }));

    const found = await findEpisodeCreatedForShow(22, "Friday Night Live", {
      excludeIds: [55],
    });

    expect(found).toEqual({
      id: 901,
      link: "https://example.com/episode/friday-night-live-2",
    });
    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("slug=friday-night-live"))).toBe(true);
    expect(urls.some((url) => url.includes("search=Friday%20Night%20Live"))).toBe(true);
    expect(urls.every((url) => url.includes("meta_value=22"))).toBe(true);
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(
      wpAuthorizationHeader()
    );
  });

  it("selectCreatedEpisode ignores another show and an excluded live post", () => {
    const posts = [
      {
        id: 55,
        title: { rendered: "Friday Night Live" },
        link: "https://example.com/live",
        slug: "friday-night-live",
        meta: { parent_show_id: 22 },
      },
      {
        id: 70,
        title: { rendered: "Friday Night Live" },
        link: "https://example.com/other-show",
        slug: "friday-night-live",
        meta: { parent_show_id: 8 },
      },
    ];

    expect(
      selectCreatedEpisode(posts, 22, "Friday Night Live", [55])
    ).toBeNull();
    expect(selectCreatedEpisode(posts, 22, "Friday Night Live")).toEqual({
      id: 55,
      link: "https://example.com/live",
    });
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
});
