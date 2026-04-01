import type { BrowserContext, Response } from "playwright";

export interface ResponseCategory {
  type: "overview" | "countries" | "applications" | "devices";
  showId: string;
}

export interface CollectedData {
  overview: Record<string, unknown> | null;
  countries: Record<string, unknown>[] | null;
  applications: Record<string, unknown>[] | null;
  devices: Record<string, unknown>[] | null;
}

const ANALYTICS_PATTERN = /\/analytics\/(\d+)(\/(\w+))?/;

export function categorizeResponse(
  url: string,
  _body: unknown
): ResponseCategory | null {
  const match = url.match(ANALYTICS_PATTERN);
  if (!match) return null;

  const showId = match[1];
  const subpath = match[3];

  if (subpath === "countries") return { type: "countries", showId };
  if (subpath === "applications") return { type: "applications", showId };
  if (subpath === "devices") return { type: "devices", showId };
  if (!subpath) return { type: "overview", showId };

  return null;
}

export async function collectShowAnalytics(
  context: BrowserContext,
  transistorShowId: string
): Promise<CollectedData> {
  const collected: CollectedData = {
    overview: null,
    countries: null,
    applications: null,
    devices: null,
  };

  const page = await context.newPage();

  // Intercept API responses
  page.on("response", async (response: Response) => {
    const url = response.url();
    if (!url.includes("/analytics/")) return;
    if (response.status() !== 200) return;

    try {
      const body = await response.json();
      const category = categorizeResponse(url, body);
      if (!category || category.showId !== transistorShowId) return;

      switch (category.type) {
        case "overview":
          collected.overview = body?.data?.attributes ?? null;
          break;
        case "countries":
          collected.countries = body?.data?.attributes?.countries ?? null;
          break;
        case "applications":
          collected.applications = body?.data?.attributes?.applications ?? null;
          break;
        case "devices":
          collected.devices = body?.data?.attributes?.devices ?? null;
          break;
      }
    } catch {
      // Non-JSON response or parsing error — skip
    }
  });

  // Navigate to the show's analytics pages to trigger the API calls
  const baseUrl = `https://dashboard.transistor.fm/shows/${transistorShowId}/analytics`;

  console.log(`[collector] Navigating to overview: ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  // Navigate to sub-pages to trigger additional API calls
  for (const subpage of ["countries", "applications", "devices"]) {
    const url = `${baseUrl}/${subpage}`;
    console.log(`[collector] Navigating to ${subpage}: ${url}`);
    await page.goto(url, { waitUntil: "networkidle" });
  }

  await page.close();
  return collected;
}
