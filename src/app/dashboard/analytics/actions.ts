"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleShows } from "@/lib/analytics/access";
import {
  getTransistorEpisodes,
  getTransistorShowAnalytics,
  getTransistorEpisodeAnalytics,
  getTransistorCountryAnalytics,
  getTransistorAppAnalytics,
  getTransistorDeviceAnalytics,
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
} from "@/lib/analytics/youtube";
import { resolvePlatformId } from "@/lib/analytics/credentials";
import { bustCachePrefix } from "@/lib/analytics/cache";
import type {
  AccessibleShow,
  DateRange,
  TransistorAnalyticsPoint,
  TransistorEpisode,
  TransistorCountryData,
  TransistorAppData,
  TransistorDeviceData,
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
  YouTubeTrafficSource,
  YouTubeCountryData,
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

export async function fetchPodcastCountries(
  wpShowId: number
): Promise<TransistorCountryData[]> {
  await requireShowAccess(wpShowId);
  return getTransistorCountryAnalytics(wpShowId);
}

export async function fetchPodcastApps(
  wpShowId: number
): Promise<TransistorAppData[]> {
  await requireShowAccess(wpShowId);
  return getTransistorAppAnalytics(wpShowId);
}

export async function fetchPodcastDevices(
  wpShowId: number
): Promise<TransistorDeviceData[]> {
  await requireShowAccess(wpShowId);
  return getTransistorDeviceAnalytics(wpShowId);
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

// --- Cache management ---

export async function refreshAnalyticsCache(
  wpShowId: number
): Promise<void> {
  await requireShowAccess(wpShowId);
  await bustCachePrefix(`analytics:transistor:${wpShowId}`);
  await bustCachePrefix(`analytics:youtube:${wpShowId}`);
}
