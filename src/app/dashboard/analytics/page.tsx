"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import ShowSelector from "@/components/analytics/show-selector";
import NetworkPicker from "@/components/analytics/network-picker";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import EpisodeTable from "@/components/analytics/episode-table";
import VideoTable from "@/components/analytics/video-table";
import { useDateRange } from "@/components/analytics/date-range-provider";
import { formatNumber } from "@/lib/analytics/date-utils";
import { getNetworksForRole, getShowName } from "@/lib/analytics/networks";
import {
  fetchAccessibleShows,
  fetchCurrentUserRole,
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
  const searchParams = useSearchParams();
  const showParam = searchParams.get("show");

  const [shows, setShows] = useState<AccessibleShow[]>([]);
  const [selectedShowId, setSelectedShowId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [role, setRole] = useState<string | null>(null);

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

  // Load shows and role on mount
  useEffect(() => {
    Promise.all([fetchAccessibleShows(), fetchCurrentUserRole()]).then(
      ([showsResult, userRole]) => {
        setShows(showsResult);
        setRole(userRole);
        const preselected = showParam ? parseInt(showParam, 10) : null;
        if (preselected && !isNaN(preselected)) {
          // Trust the URL param — admin may navigate here from network view
          // with a wpShowId that isn't in the WP shows list
          setSelectedShowId(preselected);
          // Add to shows list if missing so the selector displays it
          if (!showsResult.some((s) => s.wpShowId === preselected)) {
            setShows([
              ...showsResult,
              { wpShowId: preselected, title: getShowName(preselected) },
            ]);
          }
        } else if (showsResult.length > 0) {
          setSelectedShowId(showsResult[0].wpShowId);
        }
      }
    );
  }, [showParam]);

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

  // Loading state
  if (role === null) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  // Admin network picker (skip if a specific show is selected via URL)
  const networks = getNetworksForRole(role);
  if (networks.length > 0 && !showParam) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Select a network to view analytics
          </p>
        </div>
        <NetworkPicker networks={networks} />
      </div>
    );
  }

  // Derived stats
  const totalDownloads = podcastData.reduce((sum, p) => sum + p.downloads, 0);
  const ytTotalViews = ytAnalytics.reduce((sum, p) => sum + p.views, 0);
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
          title="YouTube Views"
          value={loading ? "" : formatNumber(ytTotalViews)}
          subtitle={`${from} – ${to}`}
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
