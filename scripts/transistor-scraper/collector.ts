import type { BrowserContext, Response } from "playwright";

export interface DonutChartData {
  downloads: number[];
  percentage: number[];
  labels: string[];
}

export interface CollectedData {
  dailyAverage: { seven: string; thirty: string; sixty: string; ninety: string } | null;
  subscribers: { total: string; datasets: unknown[]; labels: string[] } | null;
  overall: { data: { x: string; y: number }[]; total: string } | null;
  apps: { data: { label: string; total: number }[] } | null;
  countriesMap: Record<string, { downloads: number; formatted_downloads: string }> | null;
  devices: DonutChartData | null;
  platforms: DonutChartData | null;
}

interface ResponseMatch {
  type: keyof CollectedData;
}

/**
 * Categorize a dashboard API response by its URL path.
 * Transistor's dashboard uses show slugs in URLs like:
 *   /shows/{slug}/analytics/daily_average
 *   /shows/{slug}/analytics/subscribers
 *   /shows/{slug}/analytics/overall
 *   /shows/{slug}/analytics/apps
 *   /shows/{slug}/analytics/countries_map
 */
const ENDPOINT_MAP: Record<string, keyof CollectedData> = {
  daily_average: "dailyAverage",
  subscribers: "subscribers",
  overall: "overall",
  apps: "apps",
  countries_map: "countriesMap",
};

export function categorizeResponse(url: string): ResponseMatch | null {
  // Match /shows/{slug}/analytics/{endpoint}
  const match = url.match(/\/shows\/[^/]+\/analytics\/(\w+)/);
  if (!match) return null;

  const endpoint = match[1];
  const type = ENDPOINT_MAP[endpoint];
  if (!type) return null;

  return { type };
}

export async function collectShowAnalytics(
  context: BrowserContext,
  transistorShowId: string
): Promise<CollectedData> {
  const collected: CollectedData = {
    dailyAverage: null,
    subscribers: null,
    overall: null,
    apps: null,
    countriesMap: null,
    devices: null,
    platforms: null,
  };

  const page = await context.newPage();

  // Intercept API responses
  page.on("response", async (response: Response) => {
    const url = response.url();
    if (!url.includes("/analytics/")) return;
    if (response.status() !== 200) return;

    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("json")) return;

    try {
      const body = await response.json();
      const match = categorizeResponse(url);
      if (!match) return;

      switch (match.type) {
        case "dailyAverage":
          collected.dailyAverage = body?.data ?? null;
          break;
        case "subscribers":
          collected.subscribers = body ?? null;
          break;
        case "overall":
          collected.overall = body ?? null;
          break;
        case "apps":
          collected.apps = body ?? null;
          break;
        case "countriesMap":
          collected.countriesMap = body?.data ?? null;
          break;
      }
    } catch {
      // Non-JSON response or parsing error — skip
    }
  });

  // Navigate to the show's analytics page — this triggers all the API calls
  const baseUrl = `https://dashboard.transistor.fm/shows/${transistorShowId}/analytics`;

  console.log(`[collector] Navigating to: ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  // Extract device and platform data from DOM (rendered server-side as data attributes)
  const devicesRaw = await page.getAttribute("#devices-donut", "data-chart-data");
  const platformsRaw = await page.getAttribute("#platforms-donut", "data-chart-data");

  const domData = {
    devices: devicesRaw ? JSON.parse(devicesRaw) : null,
    platforms: platformsRaw ? JSON.parse(platformsRaw) : null,
  };

  collected.devices = domData.devices;
  collected.platforms = domData.platforms;

  await page.close();
  return collected;
}
