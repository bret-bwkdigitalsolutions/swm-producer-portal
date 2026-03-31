"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useDateRange } from "@/components/analytics/date-range-provider";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import EpisodeTable from "@/components/analytics/episode-table";
import VideoTable from "@/components/analytics/video-table";
import ShowBreakdownTable from "@/components/analytics/show-breakdown-table";
import { formatNumber } from "@/lib/analytics/date-utils";
import { getNetworkBySlug } from "@/lib/analytics/networks";
import {
  fetchNetworkPodcastAnalytics,
  fetchNetworkPodcastEpisodes,
  fetchNetworkShowBreakdown,
  fetchNetworkYouTubeChannel,
  fetchNetworkYouTubeVideos,
  fetchNetworkYouTubeAnalytics,
  refreshNetworkAnalyticsCache,
} from "@/app/dashboard/analytics/network/actions";
import type {
  TransistorAnalyticsPoint,
  TransistorEpisode,
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
} from "@/lib/analytics/types";
import type { NetworkShowBreakdown } from "@/app/dashboard/analytics/network/actions";

export default function NetworkOverviewPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const network = getNetworkBySlug(slug);
  const { from, to } = useDateRange();

  const [refreshing, setRefreshing] = useState(false);

  // Podcast state
  const [podcastData, setPodcastData] = useState<TransistorAnalyticsPoint[]>([]);
  const [podcastEpisodes, setPodcastEpisodes] = useState<TransistorEpisode[]>([]);
  const [showBreakdown, setShowBreakdown] = useState<NetworkShowBreakdown[]>([]);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [podcastError, setPodcastError] = useState(false);

  // YouTube state
  const [ytChannel, setYtChannel] = useState<YouTubeChannelStats | null>(null);
  const [ytVideos, setYtVideos] = useState<YouTubeVideo[]>([]);
  const [ytAnalytics, setYtAnalytics] = useState<YouTubeAnalyticsPoint[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState(false);


  const loadPodcastData = useCallback(async () => {
    setPodcastLoading(true);
    setPodcastError(false);
    try {
      const dateRange = { from, to };
      const [analytics, episodes, breakdown] = await Promise.all([
        fetchNetworkPodcastAnalytics(slug, dateRange),
        fetchNetworkPodcastEpisodes(slug),
        fetchNetworkShowBreakdown(slug, dateRange),
      ]);
      setPodcastData(analytics);
      setPodcastEpisodes(episodes);
      setShowBreakdown(breakdown);
    } catch {
      setPodcastError(true);
    } finally {
      setPodcastLoading(false);
    }
  }, [slug, from, to]);

  const loadYouTubeData = useCallback(async () => {
    setYtLoading(true);
    setYtError(false);
    try {
      const [channel, videos, analytics] = await Promise.all([
        fetchNetworkYouTubeChannel(slug),
        fetchNetworkYouTubeVideos(slug),
        fetchNetworkYouTubeAnalytics(slug, { from, to }),
      ]);
      setYtChannel(channel);
      setYtVideos(videos);
      setYtAnalytics(analytics);
    } catch {
      setYtError(true);
    } finally {
      setYtLoading(false);
    }
  }, [slug, from, to]);

  useEffect(() => {
    if (!network) return;
    loadPodcastData();
    loadYouTubeData();
  }, [network, loadPodcastData, loadYouTubeData]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshNetworkAnalyticsCache(slug);
      await Promise.all([loadPodcastData(), loadYouTubeData()]);
    } finally {
      setRefreshing(false);
    }
  }

  if (!network) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Network not found.</p>
        <Link href="/dashboard/analytics" className="text-primary hover:underline">
          Back to analytics
        </Link>
      </div>
    );
  }

  const totalDownloads = podcastData.reduce((sum, p) => sum + p.downloads, 0);
  const ytTotalViews = ytAnalytics.reduce((sum, p) => sum + p.views, 0);
  const watchHours = Math.round(
    ytAnalytics.reduce((sum, p) => sum + p.estimatedMinutesWatched, 0) / 60
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1">
            <Link
              href="/dashboard/analytics"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              All Networks
            </Link>
          </div>
          <h1 className="text-2xl font-bold">{network.name}</h1>
          <p className="text-sm text-muted-foreground">
            Network overview &middot; {network.wpShowIds.length}{" "}
            {network.wpShowIds.length === 1 ? "show" : "shows"}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {refreshing ? "Refreshing\u2026" : "Refresh Data"}
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Downloads"
          value={podcastLoading ? "" : formatNumber(totalDownloads)}
          subtitle={`${from} \u2013 ${to}`}
          loading={podcastLoading}
        />
        <StatCard
          title="YouTube Views"
          value={ytLoading ? "" : formatNumber(ytTotalViews)}
          subtitle={`${from} \u2013 ${to}`}
          loading={ytLoading}
        />
        <StatCard
          title="Watch Hours"
          value={ytLoading ? "" : formatNumber(watchHours)}
          subtitle={`${from} \u2013 ${to}`}
          loading={ytLoading}
        />
        <StatCard
          title="Subscribers"
          value={ytLoading ? "" : formatNumber(ytChannel?.subscriberCount ?? 0)}
          subtitle="All time"
          loading={ytLoading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Podcast Downloads</h2>
          {podcastError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Failed to load podcast data.
            </p>
          ) : podcastLoading ? (
            <div className="h-[300px] animate-pulse rounded bg-muted" />
          ) : (
            <TimeSeriesChart
              data={podcastData as unknown as Record<string, unknown>[]}
              xKey="date"
              series={[
                { dataKey: "downloads", name: "Downloads", color: "#6366f1" },
              ]}
              height={300}
            />
          )}
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">YouTube Views</h2>
          {ytError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Failed to load YouTube data.
            </p>
          ) : ytLoading ? (
            <div className="h-[300px] animate-pulse rounded bg-muted" />
          ) : (
            <TimeSeriesChart
              data={ytAnalytics as unknown as Record<string, unknown>[]}
              xKey="date"
              series={[
                { dataKey: "views", name: "Views", color: "#f43f5e" },
              ]}
              height={300}
            />
          )}
        </div>
      </div>

      {/* Per-Show Breakdown */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Shows</h2>
        {podcastError ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Failed to load show data.
          </p>
        ) : podcastLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : (
          <ShowBreakdownTable breakdown={showBreakdown} />
        )}
      </div>

      {/* Top Content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Recent Episodes</h2>
          {podcastError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Failed to load episodes.
            </p>
          ) : podcastLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : (
            <EpisodeTable episodes={podcastEpisodes} limit={10} />
          )}
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Top Videos</h2>
          {ytError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Failed to load videos.
            </p>
          ) : ytLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : (
            <VideoTable videos={ytVideos} limit={10} />
          )}
        </div>
      </div>
    </div>
  );
}
