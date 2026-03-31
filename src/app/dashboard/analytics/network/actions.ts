"use server";

import { auth } from "@/lib/auth";
import { getNetworkBySlug } from "@/lib/analytics/networks";
import {
  getTransistorShowAnalytics,
  getTransistorEpisodes,
} from "@/lib/analytics/transistor";
import {
  getYouTubeChannelStats,
  getYouTubeVideos,
  getYouTubeChannelAnalytics,
} from "@/lib/analytics/youtube";
import { bustCachePrefix } from "@/lib/analytics/cache";
import type {
  DateRange,
  TransistorAnalyticsPoint,
  TransistorEpisode,
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
} from "@/lib/analytics/types";

const THROTTLE_MS = 200;

async function throttledMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (const item of items) {
    try {
      const value = await fn(item);
      results.push({ status: "fulfilled", value });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
    if (items.indexOf(item) < items.length - 1) {
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }
  }
  return results;
}

export interface NetworkShowBreakdown {
  wpShowId: number;
  showName: string;
  totalDownloads: number;
  episodeCount: number;
}

async function requireAdminForNetwork(slug: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    throw new Error("Admin access required");
  }
  const network = getNetworkBySlug(slug);
  if (!network) {
    throw new Error("Network not found");
  }
  return network;
}

export async function fetchNetworkPodcastAnalytics(
  slug: string,
  dateRange: DateRange
): Promise<TransistorAnalyticsPoint[]> {
  const network = await requireAdminForNetwork(slug);

  const allShowData = await throttledMap(network.wpShowIds, (id) =>
    getTransistorShowAnalytics(id, dateRange)
  );

  const dateMap = new Map<string, number>();
  for (const result of allShowData) {
    if (result.status !== "fulfilled") continue;
    for (const point of result.value) {
      dateMap.set(point.date, (dateMap.get(point.date) ?? 0) + point.downloads);
    }
  }

  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, downloads]) => ({ date, downloads }));
}

export async function fetchNetworkPodcastEpisodes(
  slug: string
): Promise<TransistorEpisode[]> {
  const network = await requireAdminForNetwork(slug);

  const allEpisodes = await throttledMap(network.wpShowIds, (id) =>
    getTransistorEpisodes(id)
  );

  const merged: TransistorEpisode[] = [];
  for (const result of allEpisodes) {
    if (result.status === "fulfilled") {
      merged.push(...result.value);
    }
  }

  return merged.sort(
    (a, b) =>
      new Date(b.attributes.published_at).getTime() -
      new Date(a.attributes.published_at).getTime()
  );
}

export async function fetchNetworkShowBreakdown(
  slug: string,
  dateRange: DateRange
): Promise<NetworkShowBreakdown[]> {
  const network = await requireAdminForNetwork(slug);

  const results = await throttledMap(network.wpShowIds, async (wpShowId) => {
    const [analyticsResult, episodesResult] = await Promise.allSettled([
      getTransistorShowAnalytics(wpShowId, dateRange),
      getTransistorEpisodes(wpShowId),
    ]);

    const totalDownloads =
      analyticsResult.status === "fulfilled"
        ? analyticsResult.value.reduce((sum, p) => sum + p.downloads, 0)
        : 0;
    const episodeCount =
      episodesResult.status === "fulfilled" ? episodesResult.value.length : 0;
    const showName = network.showNames[wpShowId] ?? `Show #${wpShowId}`;

    return { wpShowId, showName, totalDownloads, episodeCount };
  });

  return results
    .filter((r): r is PromiseFulfilledResult<NetworkShowBreakdown> => r.status === "fulfilled")
    .map((r) => r.value)
    .sort((a, b) => b.totalDownloads - a.totalDownloads);
}

export async function fetchNetworkYouTubeChannel(
  slug: string
): Promise<YouTubeChannelStats> {
  const network = await requireAdminForNetwork(slug);
  return getYouTubeChannelStats(network.credentialWpShowId);
}

export async function fetchNetworkYouTubeVideos(
  slug: string
): Promise<YouTubeVideo[]> {
  const network = await requireAdminForNetwork(slug);
  return getYouTubeVideos(network.credentialWpShowId);
}

export async function fetchNetworkYouTubeAnalytics(
  slug: string,
  dateRange: DateRange
): Promise<YouTubeAnalyticsPoint[]> {
  const network = await requireAdminForNetwork(slug);
  return getYouTubeChannelAnalytics(network.credentialWpShowId, dateRange);
}

export async function refreshNetworkAnalyticsCache(
  slug: string
): Promise<void> {
  const network = await requireAdminForNetwork(slug);
  const busts = network.wpShowIds.map((id) =>
    bustCachePrefix(`analytics:transistor:${id}`)
  );
  busts.push(bustCachePrefix(`analytics:youtube:${network.credentialWpShowId}`));
  await Promise.all(busts);
}
