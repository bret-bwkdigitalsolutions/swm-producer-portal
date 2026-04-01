import { describe, it, expect } from "vitest";
import {
  parseOverview,
  parseGeo,
  parseApps,
  parseDevices,
} from "./parser.js";

const scrapedAt = new Date("2026-04-01T03:00:00Z");

describe("parseOverview", () => {
  it("extracts subscriber and average download stats", () => {
    const raw = {
      estimated_subscribers: 450,
      average_downloads: {
        "7_days": 120.5,
        "30_days": 98.3,
        "60_days": 85.1,
        "90_days": 72.0,
      },
      downloads: [
        { date: "2026-03", downloads: 1200 },
        { date: "2026-02", downloads: 1100 },
      ],
    };

    const result = parseOverview(raw, 22, scrapedAt);
    expect(result).toEqual({
      wpShowId: 22,
      scrapedAt,
      estimatedSubscribers: 450,
      avgDownloads7d: 120.5,
      avgDownloads30d: 98.3,
      avgDownloads60d: 85.1,
      avgDownloads90d: 72.0,
      monthlyDownloads: { "2026-03": 1200, "2026-02": 1100 },
      yearlyDownloads: null,
    });
  });

  it("handles missing fields gracefully", () => {
    const result = parseOverview({}, 22, scrapedAt);
    expect(result.estimatedSubscribers).toBeNull();
    expect(result.avgDownloads7d).toBeNull();
    expect(result.monthlyDownloads).toBeNull();
  });
});

describe("parseGeo", () => {
  it("maps country data to database rows", () => {
    const raw = [
      { country: "United States", downloads: 500, percent: 45.5 },
      { country: "Canada", downloads: 200, percent: 18.2 },
    ];

    const result = parseGeo(raw, 22, scrapedAt);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      wpShowId: 22,
      scrapedAt,
      country: "United States",
      region: null,
      downloads: 500,
      percentage: 45.5,
    });
  });
});

describe("parseApps", () => {
  it("maps application data to database rows", () => {
    const raw = [
      { app: "Apple Podcasts", downloads: 300, percent: 60.0 },
      { app: "Spotify", downloads: 200, percent: 40.0 },
    ];

    const result = parseApps(raw, 22, scrapedAt);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      wpShowId: 22,
      scrapedAt,
      appName: "Apple Podcasts",
      downloads: 300,
      percentage: 60.0,
    });
  });
});

describe("parseDevices", () => {
  it("maps device data to database rows", () => {
    const raw = [
      { device: "iPhone", device_type: "mobile", downloads: 400, percentage: 50.0 },
      { device: "Desktop", device_type: "desktop", downloads: 200, percentage: 25.0 },
    ];

    const result = parseDevices(raw, 22, scrapedAt);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      wpShowId: 22,
      scrapedAt,
      deviceType: "mobile",
      deviceName: "iPhone",
      downloads: 400,
      percentage: 50.0,
    });
  });
});
