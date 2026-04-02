import type { CollectedData, DonutChartData } from "./collector.js";

export interface ParsedOverview {
  wpShowId: number;
  scrapedAt: Date;
  estimatedSubscribers: number | null;
  avgDownloads7d: number | null;
  avgDownloads30d: number | null;
  avgDownloads60d: number | null;
  avgDownloads90d: number | null;
  monthlyDownloads: Record<string, number> | null;
  yearlyDownloads: Record<string, number> | null;
}

export interface ParsedGeo {
  wpShowId: number;
  scrapedAt: Date;
  country: string;
  region: string | null;
  downloads: number;
  percentage: number | null;
}

export interface ParsedApp {
  wpShowId: number;
  scrapedAt: Date;
  appName: string;
  downloads: number;
  percentage: number | null;
}

export interface ParsedDevice {
  wpShowId: number;
  scrapedAt: Date;
  deviceType: string;
  deviceName: string | null;
  downloads: number;
  percentage: number | null;
}

/**
 * Parse overview data from Transistor's dashboard API.
 * Sources: /analytics/daily_average, /analytics/subscribers, /analytics/overall
 */
export function parseOverview(
  data: CollectedData,
  wpShowId: number,
  scrapedAt: Date
): ParsedOverview {
  const avg = data.dailyAverage;
  const subs = data.subscribers;
  const overall = data.overall;

  // Aggregate daily downloads into monthly buckets
  let monthlyDownloads: Record<string, number> | null = null;
  if (overall?.data && overall.data.length > 0) {
    monthlyDownloads = {};
    for (const point of overall.data) {
      const month = point.x.substring(0, 7); // "2026-03-19" -> "2026-03"
      monthlyDownloads[month] = (monthlyDownloads[month] ?? 0) + point.y;
    }
  }

  return {
    wpShowId,
    scrapedAt,
    estimatedSubscribers: subs?.total ? parseInt(subs.total, 10) : null,
    avgDownloads7d: avg?.seven ? parseFloat(avg.seven) : null,
    avgDownloads30d: avg?.thirty ? parseFloat(avg.thirty) : null,
    avgDownloads60d: avg?.sixty ? parseFloat(avg.sixty) : null,
    avgDownloads90d: avg?.ninety ? parseFloat(avg.ninety) : null,
    monthlyDownloads,
    yearlyDownloads: null,
  };
}

/**
 * Parse geographic data from /analytics/countries_map.
 * Response shape: { "US": { downloads: 1, formatted_downloads: "1", color: "..." }, ... }
 */
export function parseGeo(
  countriesMap: CollectedData["countriesMap"],
  wpShowId: number,
  scrapedAt: Date
): ParsedGeo[] {
  if (!countriesMap) return [];

  const totalDownloads = Object.values(countriesMap).reduce(
    (sum, c) => sum + c.downloads,
    0
  );

  return Object.entries(countriesMap).map(([countryCode, data]) => ({
    wpShowId,
    scrapedAt,
    country: countryCode,
    region: null,
    downloads: data.downloads,
    percentage:
      totalDownloads > 0
        ? Math.round((data.downloads / totalDownloads) * 1000) / 10
        : null,
  }));
}

/**
 * Parse app data from /analytics/apps.
 * Response shape: { data: [{ label: "Apple Podcasts", total: 100, ... }, ...] }
 */
export function parseApps(
  appsData: CollectedData["apps"],
  wpShowId: number,
  scrapedAt: Date
): ParsedApp[] {
  if (!appsData?.data) return [];

  const totalDownloads = appsData.data.reduce(
    (sum, app) => sum + app.total,
    0
  );

  return appsData.data.map((app) => ({
    wpShowId,
    scrapedAt,
    appName: app.label,
    downloads: app.total,
    percentage:
      totalDownloads > 0
        ? Math.round((app.total / totalDownloads) * 1000) / 10
        : null,
  }));
}

/**
 * Parse device and platform data from DOM-embedded chart data.
 * The canvas elements have data-chart-data attributes with:
 *   { downloads: [3, 2], percentage: [60, 40], labels: ["Other", "Desktop Browser"] }
 */
export function parseDevices(
  devices: DonutChartData | null,
  platforms: DonutChartData | null,
  wpShowId: number,
  scrapedAt: Date
): ParsedDevice[] {
  const results: ParsedDevice[] = [];

  if (devices) {
    for (let i = 0; i < devices.labels.length; i++) {
      results.push({
        wpShowId,
        scrapedAt,
        deviceType: "device",
        deviceName: devices.labels[i],
        downloads: devices.downloads[i] ?? 0,
        percentage: devices.percentage[i] ?? null,
      });
    }
  }

  if (platforms) {
    for (let i = 0; i < platforms.labels.length; i++) {
      results.push({
        wpShowId,
        scrapedAt,
        deviceType: "platform",
        deviceName: platforms.labels[i],
        downloads: platforms.downloads[i] ?? 0,
        percentage: platforms.percentage[i] ?? null,
      });
    }
  }

  return results;
}
