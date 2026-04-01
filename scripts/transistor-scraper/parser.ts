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

export function parseOverview(
  raw: Record<string, unknown>,
  wpShowId: number,
  scrapedAt: Date
): ParsedOverview {
  const avgDownloads = (raw.average_downloads ?? {}) as Record<string, number>;
  const downloads = raw.downloads as { date: string; downloads: number }[] | undefined;

  let monthlyDownloads: Record<string, number> | null = null;
  if (downloads && downloads.length > 0) {
    monthlyDownloads = {};
    for (const d of downloads) {
      monthlyDownloads[d.date] = d.downloads;
    }
  }

  return {
    wpShowId,
    scrapedAt,
    estimatedSubscribers: (raw.estimated_subscribers as number) ?? null,
    avgDownloads7d: avgDownloads["7_days"] ?? null,
    avgDownloads30d: avgDownloads["30_days"] ?? null,
    avgDownloads60d: avgDownloads["60_days"] ?? null,
    avgDownloads90d: avgDownloads["90_days"] ?? null,
    monthlyDownloads,
    yearlyDownloads: null,
  };
}

export function parseGeo(
  raw: Record<string, unknown>[],
  wpShowId: number,
  scrapedAt: Date
): ParsedGeo[] {
  return raw.map((entry) => ({
    wpShowId,
    scrapedAt,
    country: (entry.country as string) ?? "Unknown",
    region: (entry.region as string) ?? null,
    downloads: (entry.downloads as number) ?? 0,
    percentage: (entry.percent as number) ?? (entry.percentage as number) ?? null,
  }));
}

export function parseApps(
  raw: Record<string, unknown>[],
  wpShowId: number,
  scrapedAt: Date
): ParsedApp[] {
  return raw.map((entry) => ({
    wpShowId,
    scrapedAt,
    appName: (entry.app as string) ?? "Unknown",
    downloads: (entry.downloads as number) ?? 0,
    percentage: (entry.percent as number) ?? (entry.percentage as number) ?? null,
  }));
}

export function parseDevices(
  raw: Record<string, unknown>[],
  wpShowId: number,
  scrapedAt: Date
): ParsedDevice[] {
  return raw.map((entry) => ({
    wpShowId,
    scrapedAt,
    deviceType: (entry.device_type as string) ?? "unknown",
    deviceName: (entry.device as string) ?? null,
    downloads: (entry.downloads as number) ?? 0,
    percentage: (entry.percentage as number) ?? (entry.percent as number) ?? null,
  }));
}
