import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const mockFetch = vi.fn();

process.env.WP_API_URL = "https://example.com/wp-json/wp/v2";
process.env.WP_APP_USER = "testuser";
process.env.WP_APP_PASSWORD = "testpass";

import { wpAuthorizationHeader } from "@/lib/wordpress/client";
import {
  findLiveStreamCandidate,
  toAirDate,
} from "@/lib/wordpress/live-candidate";
import {
  liveStreamReplacementNote,
  readSupersedesLivePostId,
} from "@/lib/live-stream-note";

const AUTH =
  "Basic " + Buffer.from("testuser:testpass").toString("base64");

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  process.env.WP_API_URL = "https://example.com/wp-json/wp/v2";
  process.env.WP_APP_USER = "testuser";
  process.env.WP_APP_PASSWORD = "testpass";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toAirDate", () => {
  it("keeps a bare calendar date without shifting it", () => {
    expect(toAirDate("2026-05-20")).toBe("2026-05-20");
  });

  it("converts an ISO datetime to the America/Chicago calendar day", () => {
    // 03:30 UTC is still the previous evening in Central (CDT, UTC-5).
    expect(toAirDate("2026-05-21T03:30:00Z")).toBe("2026-05-20");
    expect(toAirDate("2026-05-20T19:00:00-05:00")).toBe("2026-05-20");
  });

  it("uses Central Standard Time in winter", () => {
    // 05:30 UTC is 11:30pm CST (UTC-6) the previous evening.
    expect(toAirDate("2026-01-15T05:30:00Z")).toBe("2026-01-14");
    // 06:00 UTC is midnight CST, the 15th.
    expect(toAirDate("2026-01-15T06:00:00Z")).toBe("2026-01-15");
  });

  it("uses today in America/Chicago when no date is provided", () => {
    // 03:30 UTC on Oct 8 is 10:30pm CDT on Oct 7.
    const now = new Date("2026-10-08T03:30:00Z");
    expect(toAirDate(undefined, now)).toBe("2026-10-07");
    expect(toAirDate("not-a-date", now)).toBe("2026-10-07");
  });
});

describe("findLiveStreamCandidate", () => {
  it("requests the dedup endpoint with show id, air date, and WP auth", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidate: {
          id: 55,
          title: "Friday Live",
          youtube_id: "abc123xyz09",
          date: "2026-05-20",
        },
      }),
    });

    const candidate = await findLiveStreamCandidate(21, "2026-05-20");

    expect(candidate).toEqual({
      id: 55,
      title: "Friday Live",
      youtube_id: "abc123xyz09",
      date: "2026-05-20",
    });
    const [calledUrl, init] = mockFetch.mock.calls[0];
    expect(calledUrl).toBeInstanceOf(URL);
    expect((calledUrl as URL).href).toBe(
      "https://example.com/wp-json/swm/v1/dedup/live-candidate?show_id=21&date=2026-05-20"
    );
    expect(init).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: AUTH },
      })
    );
    expect((init as RequestInit).headers).toEqual({
      Authorization: wpAuthorizationHeader(),
    });
    expect(AbortSignal.timeout).toBeDefined();
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("sends youtube_id with show id and date when the live video is known", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidate: {
          id: 4234,
          title: "Rusty Greer live",
          youtube_id: "sLB7STNGACI",
          date: "2026-05-20",
        },
      }),
    });

    const candidate = await findLiveStreamCandidate(
      22,
      "2026-10-07",
      "sLB7STNGACI"
    );

    expect(candidate).toMatchObject({ id: 4234, youtube_id: "sLB7STNGACI" });
    const calledUrl = mockFetch.mock.calls[0][0] as URL;
    expect(calledUrl.href).toBe(
      "https://example.com/wp-json/swm/v1/dedup/live-candidate?show_id=22&date=2026-10-07&youtube_id=sLB7STNGACI"
    );
  });

  it("omits a blank youtube_id so the request stays show id and date", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ candidate: null }),
    });

    await findLiveStreamCandidate(22, "2026-10-07", "  ");

    const calledUrl = mockFetch.mock.calls[0][0] as URL;
    expect(calledUrl.searchParams.has("youtube_id")).toBe(false);
    expect(calledUrl.searchParams.get("date")).toBe("2026-10-07");
  });

  it("returns null when the website reports no candidate", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ candidate: null }),
    });

    await expect(findLiveStreamCandidate(22, "2026-05-20")).resolves.toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("accepts a numeric id that arrived as a string", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidate: { id: "88", title: "Live", youtube_id: "vid", date: "2026-05-20" },
      }),
    });

    await expect(findLiveStreamCandidate(22, "2026-05-20")).resolves.toMatchObject({
      id: 88,
      youtube_id: "vid",
    });
  });

  it("fails open on 404 and logs it", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ code: "rest_no_route" }),
    });

    await expect(findLiveStreamCandidate(21, "2026-05-20")).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("HTTP 404")
    );
  });

  it("fails open on server errors and network failures", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    await expect(findLiveStreamCandidate(21, "2026-05-20")).resolves.toBeNull();

    mockFetch.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(findLiveStreamCandidate(21, "2026-05-20")).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("ECONNRESET")
    );
  });

  it("fails open when WordPress is not configured", async () => {
    delete process.env.WP_API_URL;
    await expect(findLiveStreamCandidate(21, "2026-05-20")).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("fails open when the lookup times out", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    mockFetch.mockRejectedValueOnce(
      new DOMException("The operation was aborted due to timeout", "TimeoutError")
    );

    await expect(findLiveStreamCandidate(21, "2026-05-20")).resolves.toBeNull();
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("timeout")
    );
  });

  it("rejects id 0, negatives, and ids that are not plain digits", async () => {
    for (const id of [0, -3, "0", "-5", "12abc", 12.5, "08.5"]) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidate: {
            id,
            title: "Live",
            youtube_id: "vid",
            date: "2026-05-20",
          },
        }),
      });
      await expect(findLiveStreamCandidate(21, "2026-05-20")).resolves.toBeNull();
    }
  });

  it("keeps a candidate whose date is a different day", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidate: {
          id: 55,
          title: "Live",
          youtube_id: "vid",
          date: "2026-05-21",
        },
      }),
    });

    await expect(findLiveStreamCandidate(21, "2026-05-20")).resolves.toMatchObject({
      id: 55,
      youtube_id: "vid",
      date: "2026-05-21",
    });
  });

  it("normalizes a winter timestamp onto the Chicago calendar day", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidate: {
          id: 55,
          title: "Live",
          youtube_id: "vid",
          date: "2026-01-15T05:30:00Z",
        },
      }),
    });

    await expect(findLiveStreamCandidate(21, "2026-05-20")).resolves.toMatchObject({
      id: 55,
      date: "2026-01-14",
    });
  });

  it("fails open when WordPress credentials are unset", async () => {
    delete process.env.WP_APP_USER;
    delete process.env.WP_APP_PASSWORD;

    await expect(findLiveStreamCandidate(21, "2026-05-20")).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("WP_APP_USER")
    );
  });

  it("returns an empty youtube id when the field is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidate: { id: 55, title: "Live", date: "2026-05-20" },
      }),
    });

    await expect(findLiveStreamCandidate(21, "2026-05-20")).resolves.toMatchObject({
      id: 55,
      youtube_id: "",
    });
  });

  it("fails open when the body is not JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    });

    await expect(findLiveStreamCandidate(21, "2026-05-20")).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Unexpected token")
    );
  });

  it("fails open when the body is not the expected shape", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ candidate: { title: "missing id" } }),
    });

    await expect(findLiveStreamCandidate(21, "2026-05-20")).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("live stream replacement note", () => {
  it("uses the distribution copy for a post id", () => {
    expect(liveStreamReplacementNote(55)).toBe("Replaces live stream post #55");
  });

  it("reads a stored candidate id from job metadata", () => {
    expect(readSupersedesLivePostId(55)).toBe(55);
    expect(readSupersedesLivePostId("55")).toBe(55);
    expect(readSupersedesLivePostId(null)).toBeNull();
    expect(readSupersedesLivePostId("nope")).toBeNull();
    expect(readSupersedesLivePostId(0)).toBeNull();
  });
});
