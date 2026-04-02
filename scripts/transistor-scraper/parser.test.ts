import { describe, it, expect } from "vitest";
import { parseOverview, parseGeo, parseApps, parseDevices } from "./parser.js";
import type { CollectedData } from "./collector.js";

const scrapedAt = new Date("2026-04-01T03:00:00Z");

function makeCollectedData(overrides: Partial<CollectedData> = {}): CollectedData {
  return {
    dailyAverage: null,
    subscribers: null,
    overall: null,
    apps: null,
    countriesMap: null,
    devices: null,
    platforms: null,
    ...overrides,
  };
}

describe("parseOverview", () => {
  it("extracts subscriber and average download stats", () => {
    const data = makeCollectedData({
      dailyAverage: { seven: "120.5", thirty: "98.3", sixty: "85.1", ninety: "72" },
      subscribers: { total: "450", datasets: [], labels: [] },
      overall: {
        data: [
          { x: "2026-03-01", y: 100 },
          { x: "2026-03-15", y: 200 },
          { x: "2026-04-01", y: 50 },
        ],
        total: "350",
      },
    });

    const result = parseOverview(data, 22, scrapedAt);
    expect(result.estimatedSubscribers).toBe(450);
    expect(result.avgDownloads7d).toBe(120.5);
    expect(result.avgDownloads30d).toBe(98.3);
    expect(result.avgDownloads60d).toBe(85.1);
    expect(result.avgDownloads90d).toBe(72);
    expect(result.monthlyDownloads).toEqual({ "2026-03": 300, "2026-04": 50 });
  });

  it("handles missing fields gracefully", () => {
    const data = makeCollectedData();
    const result = parseOverview(data, 22, scrapedAt);
    expect(result.estimatedSubscribers).toBeNull();
    expect(result.avgDownloads7d).toBeNull();
    expect(result.monthlyDownloads).toBeNull();
  });
});

describe("parseGeo", () => {
  it("maps countries_map data to database rows with percentages", () => {
    const countriesMap = {
      US: { downloads: 500, formatted_downloads: "500" },
      CA: { downloads: 200, formatted_downloads: "200" },
    };

    const result = parseGeo(countriesMap, 22, scrapedAt);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      wpShowId: 22,
      scrapedAt,
      country: "US",
      region: null,
      downloads: 500,
      percentage: 71.4,
    });
    expect(result[1].country).toBe("CA");
    expect(result[1].percentage).toBe(28.6);
  });

  it("returns empty array for null input", () => {
    expect(parseGeo(null, 22, scrapedAt)).toEqual([]);
  });
});

describe("parseApps", () => {
  it("maps app data to database rows", () => {
    const appsData = {
      data: [
        { label: "Apple Podcasts", total: 300 },
        { label: "Spotify", total: 200 },
      ],
    };

    const result = parseApps(appsData as CollectedData["apps"], 22, scrapedAt);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      wpShowId: 22,
      scrapedAt,
      appName: "Apple Podcasts",
      downloads: 300,
      percentage: 60,
    });
  });

  it("returns empty array for null input", () => {
    expect(parseApps(null, 22, scrapedAt)).toEqual([]);
  });
});

describe("parseDevices", () => {
  it("maps device and platform donut data to rows", () => {
    const devices = {
      downloads: [400, 200],
      percentage: [66.7, 33.3],
      labels: ["iPhone", "Desktop Browser"],
    };
    const platforms = {
      downloads: [300, 100],
      percentage: [75, 25],
      labels: ["iOS", "macOS"],
    };

    const result = parseDevices(devices, platforms, 22, scrapedAt);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({
      wpShowId: 22,
      scrapedAt,
      deviceType: "device",
      deviceName: "iPhone",
      downloads: 400,
      percentage: 66.7,
    });
    expect(result[2]).toEqual({
      wpShowId: 22,
      scrapedAt,
      deviceType: "platform",
      deviceName: "iOS",
      downloads: 300,
      percentage: 75,
    });
  });

  it("returns empty array for null inputs", () => {
    expect(parseDevices(null, null, 22, scrapedAt)).toEqual([]);
  });
});
