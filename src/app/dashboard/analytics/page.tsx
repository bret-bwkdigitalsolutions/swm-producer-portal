"use client";

import { useState, useEffect, useCallback } from "react";
import ShowSelector from "@/components/analytics/show-selector";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import EpisodeTable from "@/components/analytics/episode-table";
import VideoTable from "@/components/analytics/video-table";
import { useDateRange } from "@/components/analytics/date-range-provider";
import { formatNumber } from "@/lib/analytics/date-utils";
import {
  fetchAccessibleShows,
  fetchPodcastAnalytics,
  fetchPodcastEpisodes,
  fetchYouTubeChannel,
  fetchYouTubeVideos,
  fetchYouTubeAnalytics,
  refreshAnalyticsCache,
} from "./actions";
import type {
  AccessibleShow,
  TransistorAnalyticsPoint,
  TransistorEpisode,
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
} from "@/lib/analytics/types";

export default function AnalyticsOverviewPage() {
  const { from, to } = useDateRange();

  const [shows, setShows] = useState<AccessibleShow[]>([]);
  const [selectedShowId, setSelectedShowId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Podcast state
  const [podcastData, setPodcastData] = useState<TransistorAnalyticsPoint[]>([]);
  const [podcastEpisodes, setPodcastEpisodes] = useState<TransistorEpisode[]>([]);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [podcastError, setPodcastError] = useState(false);

  // YouTube state
  const [ytChannel, setYtChannel] = useState<YouTubeChannelStats | null>(null);
  const [ytVideos, setYtVideos] = useState<YouTubeVideo[]>([]);
  const [ytAnalytics, setYtAnalytics] = useState<YouTubeAnalyticsPoint[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState(false);

  // Load shows on mount
  useEffect(() => {
    fetchAccessibleShows().then((result) => {
      setShows(result);
      if (result.length > 0) {
        setSelectedShowId(result[0].wpShowId);
      }
    });
  }, []);

  const loadPodcastData = useCallback(
    async (wpShowId: number) => {
      setPodcastLoading(true);
      setPodcastError(false);
      try {
        const [analytics, episodes] = await Promise.all([
          fetchPodcastAnalytics(wpShowId, { from, to }),
          fetchPodcastEpisodes(wpShowId),
        ]);
        setPodcastData(analytics);
        setPodcastEpisodes(episodes);
      } catch {
        setPodcastError(true);
      } finally {
        setPodcastLoading(false);
      }
    },
    [from, to]
  );

  const loadYouTubeData = useCallback(
    async (wpShowId: number) => {
      setYtLoading(true);
      setYtError(false);
      try {
        const [channel, videos, analytics] = await Promise.all([
          fetchYouTubeChannel(wpShowId),
          fetchYouTubeVideos(wpShowId),
          fetchYouTubeAnalytics(wpShowId, { from, to }),
        ]);
        setYtChannel(channel);
        setYtVideos(videos);
        setYtAnalytics(analytics);
      } catch {
        setYtError(true);
      } finally {
        setYtLoading(false);
      }
    },
    [from, to]
  );

  useEffect(() => {
    if (selectedShowId === null) return;
    loadPodcastData(selectedShowId);
    loadYouTubeData(selectedShowId);
  }, [selectedShowId, from, to, loadPodcastData, loadYouTubeData]);

  async function handleRefresh() {
    if (selectedShowId === null) return;
    setRefreshing(true);
    try {
      await refreshAnalyticsCache(selectedShowId);
      await Promise.all([
        loadPodcastData(selectedShowId),
        loadYouTubeData(selectedShowId),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  // Derived stats
  const totalDownloads = podcastData.reduce((sum, p) => sum + p.downloads, 0);
  const ytTotalViews = ytChannel?.viewCount ?? 0;
  const watchHours = ytAnalytics.reduce(
    (sum, p) => sum + p.estimatedMinutesWatched,
    0
  );

  const loading = podcastLoading || ytLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Analytics Overview</h1>
          <p className="text-sm text-muted-foreground">
            Performance across podcast and YouTube
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ShowSelector
            shows={shows}
            selectedShowId={selectedShowId}
            onChange={setSelectedShowId}
          />
          <button
            onClick={handleRefresh}
            disabled={refreshing || selectedShowId === null}
            className="rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh Data"}
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Total Downloads"
          value={loading ? "" : formatNumber(totalDownloads)}
          subtitle={`${from} – ${to}`}
          loading={podcastLoading}
        />
        <StatCard
          title="YouTube Views (All Time)"
          value={loading ? "" : formatNumber(ytTotalViews)}
          subtitle="Channel lifetime"
          loading={ytLoading}
        />
        <StatCard
          title="Watch Hours"
          value={
            loading ? "" : formatNumber(Math.round(watchHours / 60))
          }
          subtitle={`${from} – ${to}`}
          loading={ytLoading}
        />
      </div>

      {/* Time Series Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Podcast Downloads Chart */}
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

        {/* YouTube Views Chart */}
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

      {/* Tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Episodes */}
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Top Episodes</h2>
          {podcastError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Failed to load episodes.
            </p>
          ) : podcastLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded bg-muted"
                />
              ))}
            </div>
          ) : (
            <EpisodeTable episodes={podcastEpisodes} limit={10} />
          )}
        </div>

        {/* Top Videos */}
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Top Videos</h2>
          {ytError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Failed to load videos.
            </p>
          ) : ytLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded bg-muted"
                />
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
