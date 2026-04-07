import type {
  TransistorAnalyticsPoint,
  TransistorEpisode,
  YouTubeAnalyticsPoint,
  YouTubeVideo,
  YouTubeChannelStats,
  YouTubeCountryData,
} from "./types";

// These interfaces match the ones exported from actions.ts
// Duplicated here to avoid importing server-only code into shared utilities
interface ScrapedOverviewData {
  estimatedSubscribers: number | null;
  avgDownloads7d: number | null;
  avgDownloads30d: number | null;
  avgDownloads60d: number | null;
  avgDownloads90d: number | null;
  monthlyDownloads: Record<string, number> | null;
  yearlyDownloads: Record<string, number> | null;
  scrapedAt: string | null;
}

interface ScrapedGeoEntry {
  country: string;
  region: string | null;
  downloads: number;
  percentage: number | null;
}

interface ScrapedAppEntry {
  appName: string;
  downloads: number;
  percentage: number | null;
}

interface ScrapedDeviceEntry {
  deviceType: string;
  deviceName: string | null;
  downloads: number;
  percentage: number | null;
}

export function aggregateAnalyticsPoints(
  allPoints: TransistorAnalyticsPoint[][]
): TransistorAnalyticsPoint[] {
  const dateMap = new Map<string, number>();
  for (const points of allPoints) {
    for (const p of points) {
      dateMap.set(p.date, (dateMap.get(p.date) ?? 0) + p.downloads);
    }
  }
  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, downloads]) => ({ date, downloads }));
}

export function aggregateYouTubeAnalytics(
  allPoints: YouTubeAnalyticsPoint[][]
): YouTubeAnalyticsPoint[] {
  const dateMap = new Map<string, YouTubeAnalyticsPoint>();
  for (const points of allPoints) {
    for (const p of points) {
      const existing = dateMap.get(p.date);
      if (existing) {
        existing.views += p.views;
        existing.estimatedMinutesWatched += p.estimatedMinutesWatched;
        existing.subscribersGained += p.subscribersGained;
        existing.subscribersLost += p.subscribersLost;
      } else {
        dateMap.set(p.date, { ...p });
      }
    }
  }
  return Array.from(dateMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

export function aggregateGeo(
  allGeo: { data: ScrapedGeoEntry[]; scrapedAt: string | null }[]
): { data: ScrapedGeoEntry[]; scrapedAt: string | null } {
  const countryMap = new Map<string, number>();
  let latestScrapedAt: string | null = null;

  for (const geo of allGeo) {
    if (
      geo.scrapedAt &&
      (!latestScrapedAt || geo.scrapedAt > latestScrapedAt)
    ) {
      latestScrapedAt = geo.scrapedAt;
    }
    for (const entry of geo.data) {
      countryMap.set(
        entry.country,
        (countryMap.get(entry.country) ?? 0) + entry.downloads
      );
    }
  }

  const data = Array.from(countryMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([country, downloads]) => ({
      country,
      region: null,
      downloads,
      percentage: null,
    }));

  return { data, scrapedAt: latestScrapedAt };
}

export function aggregateApps(
  allApps: { data: ScrapedAppEntry[]; scrapedAt: string | null }[]
): { data: ScrapedAppEntry[]; scrapedAt: string | null } {
  const appMap = new Map<string, number>();
  let latestScrapedAt: string | null = null;

  for (const apps of allApps) {
    if (
      apps.scrapedAt &&
      (!latestScrapedAt || apps.scrapedAt > latestScrapedAt)
    ) {
      latestScrapedAt = apps.scrapedAt;
    }
    for (const entry of apps.data) {
      appMap.set(
        entry.appName,
        (appMap.get(entry.appName) ?? 0) + entry.downloads
      );
    }
  }

  const data = Array.from(appMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([appName, downloads]) => ({
      appName,
      downloads,
      percentage: null,
    }));

  return { data, scrapedAt: latestScrapedAt };
}

export function aggregateDevices(
  allDevices: { data: ScrapedDeviceEntry[]; scrapedAt: string | null }[]
): { data: ScrapedDeviceEntry[]; scrapedAt: string | null } {
  const deviceMap = new Map<string, { downloads: number; deviceName: string | null }>();
  let latestScrapedAt: string | null = null;

  for (const devices of allDevices) {
    if (
      devices.scrapedAt &&
      (!latestScrapedAt || devices.scrapedAt > latestScrapedAt)
    ) {
      latestScrapedAt = devices.scrapedAt;
    }
    for (const entry of devices.data) {
      const existing = deviceMap.get(entry.deviceType);
      if (existing) {
        existing.downloads += entry.downloads;
      } else {
        deviceMap.set(entry.deviceType, {
          downloads: entry.downloads,
          deviceName: entry.deviceName,
        });
      }
    }
  }

  const data = Array.from(deviceMap.entries())
    .sort(([, a], [, b]) => b.downloads - a.downloads)
    .map(([deviceType, { downloads, deviceName }]) => ({
      deviceType,
      deviceName,
      downloads,
      percentage: null,
    }));

  return { data, scrapedAt: latestScrapedAt };
}

export function aggregateScrapedOverviews(
  overviews: ScrapedOverviewData[]
): ScrapedOverviewData {
  const nonNull = overviews.filter((o) => o.estimatedSubscribers !== null);

  if (nonNull.length === 0) {
    return {
      estimatedSubscribers: null,
      avgDownloads7d: null,
      avgDownloads30d: null,
      avgDownloads60d: null,
      avgDownloads90d: null,
      monthlyDownloads: null,
      yearlyDownloads: null,
      scrapedAt: null,
    };
  }

  const sum = (key: keyof ScrapedOverviewData): number | null => {
    const total = overviews.reduce(
      (acc, o) => acc + ((o[key] as number) ?? 0),
      0
    );
    return total || null;
  };

  const latestScrapedAt =
    overviews
      .map((o) => o.scrapedAt)
      .filter(Boolean)
      .sort()
      .pop() ?? null;

  return {
    estimatedSubscribers: sum("estimatedSubscribers"),
    avgDownloads7d: sum("avgDownloads7d"),
    avgDownloads30d: sum("avgDownloads30d"),
    avgDownloads60d: sum("avgDownloads60d"),
    avgDownloads90d: sum("avgDownloads90d"),
    monthlyDownloads: null,
    yearlyDownloads: null,
    scrapedAt: latestScrapedAt,
  };
}

export function aggregateYouTubeChannels(
  channels: YouTubeChannelStats[]
): YouTubeChannelStats {
  return channels.reduce(
    (acc, ch) => ({
      subscriberCount: acc.subscriberCount + ch.subscriberCount,
      viewCount: acc.viewCount + ch.viewCount,
      videoCount: acc.videoCount + ch.videoCount,
    }),
    { subscriberCount: 0, viewCount: 0, videoCount: 0 }
  );
}

export function aggregateYouTubeGeo(
  allGeo: YouTubeCountryData[][]
): YouTubeCountryData[] {
  const countryMap = new Map<string, { views: number; minutes: number }>();
  for (const geo of allGeo) {
    for (const entry of geo) {
      const existing = countryMap.get(entry.country);
      if (existing) {
        existing.views += entry.views;
        existing.minutes += entry.estimatedMinutesWatched;
      } else {
        countryMap.set(entry.country, {
          views: entry.views,
          minutes: entry.estimatedMinutesWatched,
        });
      }
    }
  }
  return Array.from(countryMap.entries())
    .sort(([, a], [, b]) => b.views - a.views)
    .map(([country, { views, minutes }]) => ({
      country,
      views,
      estimatedMinutesWatched: minutes,
    }));
}

export function mergeEpisodes(
  allEpisodes: TransistorEpisode[][]
): TransistorEpisode[] {
  return allEpisodes
    .flat()
    .sort(
      (a, b) =>
        new Date(b.attributes.published_at).getTime() -
        new Date(a.attributes.published_at).getTime()
    );
}

export function mergeVideos(allVideos: YouTubeVideo[][]): YouTubeVideo[] {
  const seen = new Set<string>();
  return allVideos
    .flat()
    .filter((v) => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    })
    .sort((a, b) => b.viewCount - a.viewCount);
}
