import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/analytics/networks", () => ({
  getNetworkBySlug: vi.fn(),
}));

vi.mock("@/lib/analytics/transistor", () => ({
  getTransistorShowAnalytics: vi.fn(),
  getTransistorEpisodes: vi.fn(),
}));

vi.mock("@/lib/analytics/youtube", () => ({
  getYouTubeChannelStats: vi.fn(),
  getYouTubeChannelAnalytics: vi.fn(),
  getYouTubeVideos: vi.fn(),
}));

vi.mock("@/lib/analytics/cache", () => ({
  bustCachePrefix: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { getNetworkBySlug } from "@/lib/analytics/networks";
import { getTransistorShowAnalytics, getTransistorEpisodes } from "@/lib/analytics/transistor";
import { getYouTubeChannelStats, getYouTubeChannelAnalytics, getYouTubeVideos } from "@/lib/analytics/youtube";
import {
  fetchNetworkPodcastAnalytics,
  fetchNetworkShowBreakdown,
  fetchNetworkYouTubeChannel,
} from "@/app/dashboard/analytics/network/actions";

beforeEach(() => {
  vi.clearAllMocks();
});

const adminSession = { user: { id: "1", role: "admin" } };
const producerSession = { user: { id: "2", role: "producer" } };
const testNetwork = {
  slug: "sunset-lounge-dfw",
  name: "Sunset Lounge DFW",
  wpShowIds: [1, 2],
  credentialWpShowId: 0,
  showNames: { 1: "Test Show A", 2: "Test Show B" },
};

describe("fetchNetworkPodcastAnalytics", () => {
  it("aggregates downloads across member shows by date", async () => {
    vi.mocked(auth).mockResolvedValue(adminSession as any);
    vi.mocked(getNetworkBySlug).mockReturnValue(testNetwork);
    vi.mocked(getTransistorShowAnalytics)
      .mockResolvedValueOnce([
        { date: "2026-03-01", downloads: 100 },
        { date: "2026-03-02", downloads: 50 },
      ])
      .mockResolvedValueOnce([
        { date: "2026-03-01", downloads: 200 },
        { date: "2026-03-02", downloads: 75 },
      ]);

    const result = await fetchNetworkPodcastAnalytics("sunset-lounge-dfw", {
      from: "2026-03-01",
      to: "2026-03-02",
    });

    expect(result).toEqual([
      { date: "2026-03-01", downloads: 300 },
      { date: "2026-03-02", downloads: 125 },
    ]);
  });

  it("throws for non-admin users", async () => {
    vi.mocked(auth).mockResolvedValue(producerSession as any);

    await expect(
      fetchNetworkPodcastAnalytics("sunset-lounge-dfw", {
        from: "2026-03-01",
        to: "2026-03-02",
      })
    ).rejects.toThrow();
  });

  it("throws for invalid network slug", async () => {
    vi.mocked(auth).mockResolvedValue(adminSession as any);
    vi.mocked(getNetworkBySlug).mockReturnValue(undefined);

    await expect(
      fetchNetworkPodcastAnalytics("nonexistent", {
        from: "2026-03-01",
        to: "2026-03-02",
      })
    ).rejects.toThrow("Network not found");
  });
});

describe("fetchNetworkShowBreakdown", () => {
  it("returns per-show download totals and episode counts", async () => {
    vi.mocked(auth).mockResolvedValue(adminSession as any);
    vi.mocked(getNetworkBySlug).mockReturnValue(testNetwork);
    vi.mocked(getTransistorShowAnalytics).mockResolvedValue([
      { date: "2026-03-01", downloads: 100 },
    ]);
    vi.mocked(getTransistorEpisodes).mockResolvedValue([
      { id: "1", type: "episode", attributes: { title: "Ep1", summary: "", published_at: "", duration: 0, number: 1, status: "published", share_url: "", media_url: "", image_url: "", formatted_published_at: "" } },
    ]);

    const result = await fetchNetworkShowBreakdown("sunset-lounge-dfw", {
      from: "2026-03-01",
      to: "2026-03-02",
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      wpShowId: expect.any(Number),
      totalDownloads: 100,
      episodeCount: 1,
    });
  });
});

describe("fetchNetworkYouTubeChannel", () => {
  it("fetches channel stats using network credentialWpShowId", async () => {
    vi.mocked(auth).mockResolvedValue(adminSession as any);
    vi.mocked(getNetworkBySlug).mockReturnValue(testNetwork);
    vi.mocked(getYouTubeChannelStats).mockResolvedValue({
      subscriberCount: 1000,
      viewCount: 50000,
      videoCount: 100,
    });

    const result = await fetchNetworkYouTubeChannel("sunset-lounge-dfw");

    expect(result).toEqual({
      subscriberCount: 1000,
      viewCount: 50000,
      videoCount: 100,
    });
    expect(getYouTubeChannelStats).toHaveBeenCalledWith(0); // credentialWpShowId
  });
});
