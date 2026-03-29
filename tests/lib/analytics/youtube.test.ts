import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/analytics/credentials", () => ({
  getYouTubeAccessToken: vi.fn(),
}));

vi.mock("@/lib/analytics/cache", () => ({
  getCached: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { getYouTubeChannelStats, getYouTubeChannelAnalytics } from "@/lib/analytics/youtube";
import { getYouTubeAccessToken } from "@/lib/analytics/credentials";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getYouTubeChannelStats", () => {
  it("fetches channel statistics", async () => {
    vi.mocked(getYouTubeAccessToken).mockResolvedValue("access-token");

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              statistics: {
                subscriberCount: "1000",
                viewCount: "50000",
                videoCount: "120",
              },
            },
          ],
        }),
    });

    const result = await getYouTubeChannelStats(5);

    expect(result).toEqual({
      subscriberCount: 1000,
      viewCount: 50000,
      videoCount: 120,
    });
  });

  it("throws when no access token available", async () => {
    vi.mocked(getYouTubeAccessToken).mockResolvedValue(null);

    await expect(getYouTubeChannelStats(5)).rejects.toThrow(
      "No YouTube credentials"
    );
  });
});

describe("getYouTubeChannelAnalytics", () => {
  it("fetches and parses channel analytics rows", async () => {
    vi.mocked(getYouTubeAccessToken).mockResolvedValue("access-token");

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          rows: [
            ["2026-03-01", 100, 500, 5, 1],
            ["2026-03-02", 150, 700, 8, 2],
          ],
        }),
    });

    const result = await getYouTubeChannelAnalytics(5, {
      from: "2026-03-01",
      to: "2026-03-02",
    });

    expect(result).toEqual([
      {
        date: "2026-03-01",
        views: 100,
        estimatedMinutesWatched: 500,
        subscribersGained: 5,
        subscribersLost: 1,
      },
      {
        date: "2026-03-02",
        views: 150,
        estimatedMinutesWatched: 700,
        subscribersGained: 8,
        subscribersLost: 2,
      },
    ]);
  });
});
