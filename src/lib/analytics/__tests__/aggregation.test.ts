import { describe, it, expect } from "vitest";
import {
  aggregateAnalyticsPoints,
  aggregateYouTubeAnalytics,
  aggregateGeo,
  aggregateApps,
  aggregateScrapedOverviews,
  mergeEpisodes,
  mergeVideos,
} from "../aggregation";

describe("aggregateAnalyticsPoints", () => {
  it("sums downloads by date across multiple shows", () => {
    const result = aggregateAnalyticsPoints([
      [
        { date: "2026-03-01", downloads: 10 },
        { date: "2026-03-02", downloads: 20 },
      ],
      [
        { date: "2026-03-01", downloads: 5 },
        { date: "2026-03-02", downloads: 15 },
        { date: "2026-03-03", downloads: 8 },
      ],
    ]);
    expect(result).toEqual([
      { date: "2026-03-01", downloads: 15 },
      { date: "2026-03-02", downloads: 35 },
      { date: "2026-03-03", downloads: 8 },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(aggregateAnalyticsPoints([])).toEqual([]);
  });

  it("passes through single show unchanged", () => {
    const data = [{ date: "2026-03-01", downloads: 42 }];
    expect(aggregateAnalyticsPoints([data])).toEqual(data);
  });
});

describe("aggregateYouTubeAnalytics", () => {
  it("sums all fields by date", () => {
    const result = aggregateYouTubeAnalytics([
      [{ date: "2026-03-01", views: 100, estimatedMinutesWatched: 50, subscribersGained: 3, subscribersLost: 1 }],
      [{ date: "2026-03-01", views: 200, estimatedMinutesWatched: 80, subscribersGained: 5, subscribersLost: 2 }],
    ]);
    expect(result).toEqual([
      { date: "2026-03-01", views: 300, estimatedMinutesWatched: 130, subscribersGained: 8, subscribersLost: 3 },
    ]);
  });
});

describe("aggregateGeo", () => {
  it("sums downloads by country", () => {
    const result = aggregateGeo([
      { data: [{ country: "United States", region: null, downloads: 100, percentage: null }], scrapedAt: "2026-03-01T00:00:00Z" },
      { data: [{ country: "United States", region: null, downloads: 50, percentage: null }, { country: "Canada", region: null, downloads: 20, percentage: null }], scrapedAt: "2026-03-01T00:00:00Z" },
    ]);
    expect(result.data).toEqual([
      { country: "United States", region: null, downloads: 150, percentage: null },
      { country: "Canada", region: null, downloads: 20, percentage: null },
    ]);
  });
});

describe("aggregateApps", () => {
  it("sums downloads by app name", () => {
    const result = aggregateApps([
      { data: [{ appName: "Spotify", downloads: 200, percentage: null }], scrapedAt: "2026-03-01T00:00:00Z" },
      { data: [{ appName: "Spotify", downloads: 100, percentage: null }, { appName: "Apple Podcasts", downloads: 80, percentage: null }], scrapedAt: "2026-03-01T00:00:00Z" },
    ]);
    expect(result.data).toEqual([
      { appName: "Spotify", downloads: 300, percentage: null },
      { appName: "Apple Podcasts", downloads: 80, percentage: null },
    ]);
  });
});

describe("aggregateScrapedOverviews", () => {
  it("sums subscriber counts and averages", () => {
    const result = aggregateScrapedOverviews([
      { estimatedSubscribers: 1000, avgDownloads7d: 50, avgDownloads30d: 40, avgDownloads60d: 35, avgDownloads90d: 30, monthlyDownloads: null, yearlyDownloads: null, scrapedAt: "2026-03-01T00:00:00Z" },
      { estimatedSubscribers: 500, avgDownloads7d: 25, avgDownloads30d: 20, avgDownloads60d: 15, avgDownloads90d: 10, monthlyDownloads: null, yearlyDownloads: null, scrapedAt: "2026-03-02T00:00:00Z" },
    ]);
    expect(result.estimatedSubscribers).toBe(1500);
    expect(result.avgDownloads7d).toBe(75);
    expect(result.avgDownloads30d).toBe(60);
  });

  it("handles null values", () => {
    const result = aggregateScrapedOverviews([
      { estimatedSubscribers: null, avgDownloads7d: null, avgDownloads30d: null, avgDownloads60d: null, avgDownloads90d: null, monthlyDownloads: null, yearlyDownloads: null, scrapedAt: null },
    ]);
    expect(result.estimatedSubscribers).toBeNull();
  });
});

describe("mergeEpisodes", () => {
  it("flattens and sorts by published_at descending", () => {
    const result = mergeEpisodes([
      [{ id: "1", type: "episode", attributes: { title: "Ep 1", summary: "", published_at: "2026-03-01", duration: 100, number: 1, status: "published", share_url: "", media_url: "", image_url: "", formatted_published_at: "" } }],
      [{ id: "2", type: "episode", attributes: { title: "Ep 2", summary: "", published_at: "2026-03-05", duration: 200, number: 1, status: "published", share_url: "", media_url: "", image_url: "", formatted_published_at: "" } }],
    ]);
    expect(result[0].id).toBe("2");
    expect(result[1].id).toBe("1");
  });
});

describe("mergeVideos", () => {
  it("flattens and sorts by viewCount descending", () => {
    const result = mergeVideos([
      [{ id: "a", title: "V1", description: "", publishedAt: "", thumbnailUrl: "", duration: "", viewCount: 100, likeCount: 0, commentCount: 0 }],
      [{ id: "b", title: "V2", description: "", publishedAt: "", thumbnailUrl: "", duration: "", viewCount: 500, likeCount: 0, commentCount: 0 }],
    ]);
    expect(result[0].id).toBe("b");
    expect(result[1].id).toBe("a");
  });
});
