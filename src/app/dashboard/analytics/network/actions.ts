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

export interface NetworkShowBreakdown {
  wpShowId: number;
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

  const allShowData = await Promise.allSettled(
    network.wpShowIds.map((id) => getTransistorShowAnalytics(id, dateRange))
  );

  for (let i = 0; i < allShowData.length; i++) {
    const result = allShowData[i];
    if (result.status === "rejected") {
      console.error(`[network-analytics] Transistor failed for wpShowId=${network.wpShowIds[i]}:`, result.reason?.message ?? result.reason);
    }
  }

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

  const allEpisodes = await Promise.allSettled(
    network.wpShowIds.map((id) => getTransistorEpisodes(id))
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

  const results = await Promise.all(
    network.wpShowIds.map(async (wpShowId) => {
      const [analytics, episodes] = await Promise.allSettled([
        getTransistorShowAnalytics(wpShowId, dateRange),
        getTransistorEpisodes(wpShowId),
      ]);

      const totalDownloads =
        analytics.status === "fulfilled"
          ? analytics.value.reduce((sum, p) => sum + p.downloads, 0)
          : 0;
      const episodeCount =
        episodes.status === "fulfilled" ? episodes.value.length : 0;

      return { wpShowId, totalDownloads, episodeCount };
    })
  );

  return results.sort((a, b) => b.totalDownloads - a.totalDownloads);
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
