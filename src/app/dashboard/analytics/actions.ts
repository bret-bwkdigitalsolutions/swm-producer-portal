"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleShows } from "@/lib/analytics/access";
import {
  getTransistorEpisodes,
  getTransistorShowAnalytics,
  getTransistorEpisodeAnalytics,
} from "@/lib/analytics/transistor";
import {
  getYouTubeChannelStats,
  getYouTubeVideos,
  getYouTubeChannelAnalytics,
  getYouTubeVideoAnalytics,
  getYouTubeTrafficSources,
  getYouTubeGeoAnalytics,
  getPlaylistAnalytics,
  getPlaylistVideos,
  getYouTubeDemographics,
  getYouTubeSubscriptionStatus,
  getYouTubeDeviceTypes,
  getYouTubeContentTypes,
} from "@/lib/analytics/youtube";
import { resolvePlatformId } from "@/lib/analytics/credentials";
import { bustCachePrefix } from "@/lib/analytics/cache";
import {
  aggregateAnalyticsPoints,
  aggregateYouTubeAnalytics,
  aggregateYouTubeChannels,
  aggregateYouTubeGeo,
  aggregateGeo,
  aggregateApps,
  aggregateDevices,
  aggregateScrapedOverviews,
  mergeEpisodes,
  mergeVideos,
  aggregateYouTubeDemographics,
  aggregateYouTubeSubscription,
  aggregateYouTubeDevices,
  aggregateYouTubeContentTypes,
} from "@/lib/analytics/aggregation";
import type {
  AccessibleShow,
  DateRange,
  TransistorAnalyticsPoint,
  TransistorEpisode,
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
  YouTubeTrafficSource,
  YouTubeCountryData,
  YouTubeDemographic,
  YouTubeSubscriptionStatus,
  YouTubeDeviceType,
  YouTubeContentType,
} from "@/lib/analytics/types";

async function requireShowAccess(wpShowId: number): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  if (session.user.role === "admin") return;

  const access = await db.userShowAccess.findUnique({
    where: { userId_wpShowId: { userId: session.user.id, wpShowId } },
  });
  if (!access) throw new Error("Access denied");
}

export async function fetchAccessibleShows(): Promise<AccessibleShow[]> {
  const session = await auth();
  if (!session?.user) return [];
  return getAccessibleShows(session.user.id, session.user.role);
}

export async function fetchCurrentUserRole(): Promise<string> {
  const session = await auth();
  if (!session?.user) return "producer";
  return session.user.role;
}

// --- Transistor actions ---

export async function fetchPodcastEpisodes(
  wpShowId: number
): Promise<TransistorEpisode[]> {
  await requireShowAccess(wpShowId);
  return getTransistorEpisodes(wpShowId);
}

export async function fetchPodcastAnalytics(
  wpShowId: number,
  dateRange: DateRange
): Promise<TransistorAnalyticsPoint[]> {
  await requireShowAccess(wpShowId);
  return getTransistorShowAnalytics(wpShowId, dateRange);
}

export async function fetchEpisodeAnalytics(
  wpShowId: number,
  episodeId: string,
  dateRange: DateRange
): Promise<TransistorAnalyticsPoint[]> {
  await requireShowAccess(wpShowId);
  return getTransistorEpisodeAnalytics(wpShowId, episodeId, dateRange);
}


// --- YouTube actions ---

async function resolvePlaylistId(wpShowId: number): Promise<string | null> {
  const url = await resolvePlatformId(wpShowId, "youtube_playlist");
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("list");
  } catch {
    return null;
  }
}

export async function fetchYouTubeChannel(
  wpShowId: number
): Promise<YouTubeChannelStats> {
  await requireShowAccess(wpShowId);
  return getYouTubeChannelStats(wpShowId);
}

export async function fetchYouTubeVideos(
  wpShowId: number
): Promise<YouTubeVideo[]> {
  await requireShowAccess(wpShowId);
  const playlistId = await resolvePlaylistId(wpShowId);
  if (playlistId) return getPlaylistVideos(wpShowId, playlistId);
  return getYouTubeVideos(wpShowId);
}

export async function fetchYouTubeAnalytics(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeAnalyticsPoint[]> {
  await requireShowAccess(wpShowId);
  const playlistId = await resolvePlaylistId(wpShowId);
  if (playlistId) return getPlaylistAnalytics(wpShowId, playlistId, dateRange);
  return getYouTubeChannelAnalytics(wpShowId, dateRange);
}

export async function fetchYouTubeVideoDetail(
  wpShowId: number,
  videoId: string,
  dateRange: DateRange
): Promise<YouTubeAnalyticsPoint[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeVideoAnalytics(wpShowId, videoId, dateRange);
}

export async function fetchYouTubeTraffic(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeTrafficSource[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeTrafficSources(wpShowId, dateRange);
}

export async function fetchYouTubeGeo(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeCountryData[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeGeoAnalytics(wpShowId, dateRange);
}

export async function fetchYouTubeDemographics(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeDemographic[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeDemographics(wpShowId, dateRange);
}

export async function fetchYouTubeSubscription(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeSubscriptionStatus[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeSubscriptionStatus(wpShowId, dateRange);
}

export async function fetchYouTubeDevices(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeDeviceType[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeDeviceTypes(wpShowId, dateRange);
}

export async function fetchYouTubeContentTypes(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeContentType[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeContentTypes(wpShowId, dateRange);
}

// --- Scraped Transistor analytics actions ---

export interface ScrapedOverviewData {
  estimatedSubscribers: number | null;
  avgDownloads7d: number | null;
  avgDownloads30d: number | null;
  avgDownloads60d: number | null;
  avgDownloads90d: number | null;
  monthlyDownloads: Record<string, number> | null;
  yearlyDownloads: Record<string, number> | null;
  scrapedAt: string | null;
}

export interface ScrapedGeoEntry {
  country: string;
  region: string | null;
  downloads: number;
  percentage: number | null;
}

export interface ScrapedAppEntry {
  appName: string;
  downloads: number;
  percentage: number | null;
}

export interface ScrapedDeviceEntry {
  deviceType: string;
  deviceName: string | null;
  downloads: number;
  percentage: number | null;
}

export async function fetchScrapedOverview(
  wpShowId: number
): Promise<ScrapedOverviewData> {
  await requireShowAccess(wpShowId);

  const latest = await db.transistorScrapedOverview.findFirst({
    where: { wpShowId },
    orderBy: { scrapedAt: "desc" },
  });

  if (!latest) {
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

  return {
    estimatedSubscribers: latest.estimatedSubscribers,
    avgDownloads7d: latest.avgDownloads7d,
    avgDownloads30d: latest.avgDownloads30d,
    avgDownloads60d: latest.avgDownloads60d,
    avgDownloads90d: latest.avgDownloads90d,
    monthlyDownloads: latest.monthlyDownloads as Record<string, number> | null,
    yearlyDownloads: latest.yearlyDownloads as Record<string, number> | null,
    scrapedAt: latest.scrapedAt.toISOString(),
  };
}

export async function fetchScrapedGeo(
  wpShowId: number
): Promise<{ data: ScrapedGeoEntry[]; scrapedAt: string | null }> {
  await requireShowAccess(wpShowId);

  const latest = await db.transistorScrapedGeo.findFirst({
    where: { wpShowId },
    orderBy: { scrapedAt: "desc" },
    select: { scrapedAt: true },
  });

  if (!latest) return { data: [], scrapedAt: null };

  const rows = await db.transistorScrapedGeo.findMany({
    where: { wpShowId, scrapedAt: latest.scrapedAt },
    orderBy: { downloads: "desc" },
  });

  return {
    data: rows.map((r) => ({
      country: r.country,
      region: r.region,
      downloads: r.downloads,
      percentage: r.percentage,
    })),
    scrapedAt: latest.scrapedAt.toISOString(),
  };
}

export async function fetchScrapedApps(
  wpShowId: number
): Promise<{ data: ScrapedAppEntry[]; scrapedAt: string | null }> {
  await requireShowAccess(wpShowId);

  const latest = await db.transistorScrapedApps.findFirst({
    where: { wpShowId },
    orderBy: { scrapedAt: "desc" },
    select: { scrapedAt: true },
  });

  if (!latest) return { data: [], scrapedAt: null };

  const rows = await db.transistorScrapedApps.findMany({
    where: { wpShowId, scrapedAt: latest.scrapedAt },
    orderBy: { downloads: "desc" },
  });

  return {
    data: rows.map((r) => ({
      appName: r.appName,
      downloads: r.downloads,
      percentage: r.percentage,
    })),
    scrapedAt: latest.scrapedAt.toISOString(),
  };
}

export async function fetchScrapedDevices(
  wpShowId: number
): Promise<{ data: ScrapedDeviceEntry[]; scrapedAt: string | null }> {
  await requireShowAccess(wpShowId);

  const latest = await db.transistorScrapedDevices.findFirst({
    where: { wpShowId },
    orderBy: { scrapedAt: "desc" },
    select: { scrapedAt: true },
  });

  if (!latest) return { data: [], scrapedAt: null };

  const rows = await db.transistorScrapedDevices.findMany({
    where: { wpShowId, scrapedAt: latest.scrapedAt },
    orderBy: { downloads: "desc" },
  });

  return {
    data: rows.map((r) => ({
      deviceType: r.deviceType,
      deviceName: r.deviceName,
      downloads: r.downloads,
      percentage: r.percentage,
    })),
    scrapedAt: latest.scrapedAt.toISOString(),
  };
}

export async function fetchScraperHealth(): Promise<{
  lastRun: Date | null;
  status: string | null;
  errors: unknown;
}> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { lastRun: null, status: null, errors: null };
  }

  const latest = await db.transistorScrapeLog.findFirst({
    orderBy: { startedAt: "desc" },
  });

  if (!latest) return { lastRun: null, status: null, errors: null };

  return {
    lastRun: latest.startedAt,
    status: latest.status,
    errors: latest.errors,
  };
}

// --- Cache management ---

export async function refreshAnalyticsCache(
  wpShowId: number
): Promise<void> {
  await requireShowAccess(wpShowId);
  await bustCachePrefix(`analytics:transistor:${wpShowId}`);
  await bustCachePrefix(`analytics:youtube:${wpShowId}`);
}

// --- Aggregated multi-show actions ---

const THROTTLE_MS = 200;

async function throttledMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i++) {
    try {
      results.push(await fn(items[i]));
    } catch {
      // Skip failed shows, don't break the aggregate
    }
    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }
  }
  return results;
}

export async function fetchAggregatedPodcastAnalytics(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<TransistorAnalyticsPoint[]> {
  const allData = await throttledMap(wpShowIds, (id) =>
    getTransistorShowAnalytics(id, dateRange)
  );
  return aggregateAnalyticsPoints(allData);
}

export async function fetchAggregatedPodcastEpisodes(
  wpShowIds: number[]
): Promise<TransistorEpisode[]> {
  const allEpisodes = await throttledMap(wpShowIds, (id) =>
    getTransistorEpisodes(id)
  );
  return mergeEpisodes(allEpisodes);
}

export async function fetchAggregatedYouTubeChannel(
  wpShowIds: number[]
): Promise<YouTubeChannelStats> {
  const allChannels = await throttledMap(wpShowIds, (id) =>
    getYouTubeChannelStats(id)
  );
  return aggregateYouTubeChannels(allChannels);
}

export async function fetchAggregatedYouTubeVideos(
  wpShowIds: number[]
): Promise<YouTubeVideo[]> {
  const allVideos = await throttledMap(wpShowIds, (id) =>
    getYouTubeVideos(id)
  );
  return mergeVideos(allVideos);
}

export async function fetchAggregatedYouTubeAnalytics(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<YouTubeAnalyticsPoint[]> {
  const allData = await throttledMap(wpShowIds, (id) =>
    getYouTubeChannelAnalytics(id, dateRange)
  );
  return aggregateYouTubeAnalytics(allData);
}

export async function fetchAggregatedYouTubeGeo(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<YouTubeCountryData[]> {
  const allGeo = await throttledMap(wpShowIds, (id) =>
    getYouTubeGeoAnalytics(id, dateRange)
  );
  return aggregateYouTubeGeo(allGeo);
}

export async function fetchAggregatedYouTubeDemographics(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<YouTubeDemographic[]> {
  const allDemos = await throttledMap(wpShowIds, (id) =>
    getYouTubeDemographics(id, dateRange)
  );
  return aggregateYouTubeDemographics(allDemos);
}

export async function fetchAggregatedYouTubeSubscription(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<YouTubeSubscriptionStatus[]> {
  const allSubs = await throttledMap(wpShowIds, (id) =>
    getYouTubeSubscriptionStatus(id, dateRange)
  );
  return aggregateYouTubeSubscription(allSubs);
}

export async function fetchAggregatedYouTubeDevices(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<YouTubeDeviceType[]> {
  const allDevices = await throttledMap(wpShowIds, (id) =>
    getYouTubeDeviceTypes(id, dateRange)
  );
  return aggregateYouTubeDevices(allDevices);
}

export async function fetchAggregatedYouTubeContentTypes(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<YouTubeContentType[]> {
  const allTypes = await throttledMap(wpShowIds, (id) =>
    getYouTubeContentTypes(id, dateRange)
  );
  return aggregateYouTubeContentTypes(allTypes);
}

export async function fetchAggregatedScrapedOverview(
  wpShowIds: number[]
): Promise<ScrapedOverviewData> {
  const allOverviews = await throttledMap(wpShowIds, (id) =>
    fetchScrapedOverview(id)
  );
  return aggregateScrapedOverviews(allOverviews);
}

export async function fetchAggregatedScrapedGeo(
  wpShowIds: number[]
): Promise<{ data: ScrapedGeoEntry[]; scrapedAt: string | null }> {
  const allGeo = await throttledMap(wpShowIds, (id) => fetchScrapedGeo(id));
  return aggregateGeo(allGeo);
}

export async function fetchAggregatedScrapedApps(
  wpShowIds: number[]
): Promise<{ data: ScrapedAppEntry[]; scrapedAt: string | null }> {
  const allApps = await throttledMap(wpShowIds, (id) => fetchScrapedApps(id));
  return aggregateApps(allApps);
}

export async function fetchAggregatedScrapedDevices(
  wpShowIds: number[]
): Promise<{ data: ScrapedDeviceEntry[]; scrapedAt: string | null }> {
  const allDevices = await throttledMap(wpShowIds, (id) => fetchScrapedDevices(id));
  return aggregateDevices(allDevices);
}

export async function refreshAggregatedCache(
  wpShowIds: number[]
): Promise<void> {
  for (const id of wpShowIds) {
    await bustCachePrefix(`analytics:transistor:${id}`);
    await bustCachePrefix(`analytics:youtube:${id}`);
  }
}
