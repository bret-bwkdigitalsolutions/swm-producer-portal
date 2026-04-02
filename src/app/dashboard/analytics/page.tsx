"use client";

import { useState, useEffect, useCallback } from "react";
import HierarchicalShowSelector from "@/components/analytics/hierarchical-show-selector";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import EpisodeTable from "@/components/analytics/episode-table";
import VideoTable from "@/components/analytics/video-table";
import OverviewGeoSection from "@/components/analytics/overview-geo-section";
import OverviewPlatformsSection from "@/components/analytics/overview-platforms-section";
import OverviewAudienceSection from "@/components/analytics/overview-audience-section";
import { useDateRange } from "@/components/analytics/date-range-provider";
import { useAnalyticsSelection } from "@/components/analytics/analytics-selection-provider";
import { formatNumber } from "@/lib/analytics/date-utils";
import {
  fetchAccessibleShows,
  fetchCurrentUserRole,
  fetchPodcastAnalytics,
  fetchPodcastEpisodes,
  fetchYouTubeChannel,
  fetchYouTubeVideos,
  fetchYouTubeAnalytics,
  fetchYouTubeGeo,
  fetchScrapedOverview,
  fetchScrapedGeo,
  fetchScrapedApps,
  refreshAnalyticsCache,
  fetchAggregatedPodcastAnalytics,
  fetchAggregatedPodcastEpisodes,
  fetchAggregatedYouTubeChannel,
  fetchAggregatedYouTubeVideos,
  fetchAggregatedYouTubeAnalytics,
  fetchAggregatedYouTubeGeo,
  fetchAggregatedScrapedOverview,
  fetchAggregatedScrapedGeo,
  fetchAggregatedScrapedApps,
  refreshAggregatedCache,
} from "./actions";
import type {
  ScrapedOverviewData,
  ScrapedGeoEntry,
  ScrapedAppEntry,
} from "./actions";
import type {
  TransistorAnalyticsPoint,
  TransistorEpisode,
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
  YouTubeCountryData,
} from "@/lib/analytics/types";

export default function AnalyticsOverviewPage() {
  const { from, to } = useDateRange();
  const {
    selection,
    showsInScope,
    accessibleShows,
    setAccessibleShows,
    role,
    setRole,
  } = useAnalyticsSelection();

  const [refreshing, setRefreshing] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Podcast state
  const [podcastData, setPodcastData] = useState<TransistorAnalyticsPoint[]>(
    []
  );
  const [podcastEpisodes, setPodcastEpisodes] = useState<TransistorEpisode[]>(
    []
  );
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [podcastError, setPodcastError] = useState(false);

  // Scraped data state
  const [scrapedOverview, setScrapedOverview] =
    useState<ScrapedOverviewData | null>(null);
  const [scrapedGeo, setScrapedGeo] = useState<{
    data: ScrapedGeoEntry[];
    scrapedAt: string | null;
  }>({ data: [], scrapedAt: null });
  const [scrapedApps, setScrapedApps] = useState<{
    data: ScrapedAppEntry[];
    scrapedAt: string | null;
  }>({ data: [], scrapedAt: null });

  // YouTube state
  const [ytGeo, setYtGeo] = useState<YouTubeCountryData[]>([]);
  const [ytChannel, setYtChannel] = useState<YouTubeChannelStats | null>(null);
  const [ytVideos, setYtVideos] = useState<YouTubeVideo[]>([]);
  const [ytAnalytics, setYtAnalytics] = useState<YouTubeAnalyticsPoint[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState(false);

  // Initialize shows and role
  useEffect(() => {
    Promise.all([fetchAccessibleShows(), fetchCurrentUserRole()]).then(
      ([shows, userRole]) => {
        setAccessibleShows(shows);
        setRole(userRole);
        setInitialized(true);
      }
    );
  }, [setAccessibleShows, setRole]);

  const loadPodcastData = useCallback(
    async (wpShowIds: number[]) => {
      setPodcastLoading(true);
      setPodcastError(false);
      try {
        if (wpShowIds.length === 1) {
          const [analytics, episodes, overview] = await Promise.all([
            fetchPodcastAnalytics(wpShowIds[0], { from, to }),
            fetchPodcastEpisodes(wpShowIds[0]),
            fetchScrapedOverview(wpShowIds[0]),
          ]);
          setPodcastData(analytics);
          setPodcastEpisodes(episodes);
          setScrapedOverview(overview);
        } else {
          const [analytics, episodes, overview] = await Promise.all([
            fetchAggregatedPodcastAnalytics(wpShowIds, { from, to }),
            fetchAggregatedPodcastEpisodes(wpShowIds),
            fetchAggregatedScrapedOverview(wpShowIds),
          ]);
          setPodcastData(analytics);
          setPodcastEpisodes(episodes);
          setScrapedOverview(overview);
        }
      } catch {
        setPodcastError(true);
      } finally {
        setPodcastLoading(false);
      }

      // Fetch scraped geo/apps independently
      if (wpShowIds.length === 1) {
        fetchScrapedGeo(wpShowIds[0]).then(setScrapedGeo).catch(() => {});
        fetchScrapedApps(wpShowIds[0]).then(setScrapedApps).catch(() => {});
      } else {
        fetchAggregatedScrapedGeo(wpShowIds).then(setScrapedGeo).catch(() => {});
        fetchAggregatedScrapedApps(wpShowIds).then(setScrapedApps).catch(() => {});
      }
    },
    [from, to]
  );

  const loadYouTubeData = useCallback(
    async (wpShowIds: number[]) => {
      setYtLoading(true);
      setYtError(false);
      try {
        if (wpShowIds.length === 1) {
          const [channel, videos, analytics, geo] = await Promise.all([
            fetchYouTubeChannel(wpShowIds[0]),
            fetchYouTubeVideos(wpShowIds[0]),
            fetchYouTubeAnalytics(wpShowIds[0], { from, to }),
            fetchYouTubeGeo(wpShowIds[0], { from, to }),
          ]);
          setYtChannel(channel);
          setYtVideos(videos);
          setYtAnalytics(analytics);
          setYtGeo(geo);
        } else {
          const [channel, videos, analytics, geo] = await Promise.all([
            fetchAggregatedYouTubeChannel(wpShowIds),
            fetchAggregatedYouTubeVideos(wpShowIds),
            fetchAggregatedYouTubeAnalytics(wpShowIds, { from, to }),
            fetchAggregatedYouTubeGeo(wpShowIds, { from, to }),
          ]);
          setYtChannel(channel);
          setYtVideos(videos);
          setYtAnalytics(analytics);
          setYtGeo(geo);
        }
      } catch {
        setYtError(true);
      } finally {
        setYtLoading(false);
      }
    },
    [from, to]
  );

  // Fetch data when selection or date range changes
  useEffect(() => {
    if (!initialized || showsInScope.length === 0) return;
    loadPodcastData(showsInScope);
    loadYouTubeData(showsInScope);
  }, [initialized, showsInScope, from, to, loadPodcastData, loadYouTubeData]);

  async function handleRefresh() {
    if (showsInScope.length === 0) return;
    setRefreshing(true);
    try {
      if (showsInScope.length === 1) {
        await refreshAnalyticsCache(showsInScope[0]);
      } else {
        await refreshAggregatedCache(showsInScope);
      }
      await Promise.all([
        loadPodcastData(showsInScope),
        loadYouTubeData(showsInScope),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  if (!initialized) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  // Derived stats
  const totalDownloads = podcastData.reduce((sum, p) => sum + p.downloads, 0);
  const ytTotalViews = ytAnalytics.reduce((sum, p) => sum + p.views, 0);
  const watchHours = ytAnalytics.reduce(
    (sum, p) => sum + p.estimatedMinutesWatched,
    0
  );
  const loading = podcastLoading || ytLoading;

  // Selection label for subtitle
  const subtitle =
    selection.level === "all"
      ? "All networks combined"
      : selection.level === "network"
        ? selection.network.name
        : "Performance across podcast and YouTube";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Analytics Overview</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <HierarchicalShowSelector />
          <button
            onClick={handleRefresh}
            disabled={refreshing || showsInScope.length === 0}
            className="rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {refreshing ? "Refreshing\u2026" : "Refresh Data"}
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard
          title="Total Downloads"
          value={loading ? "" : formatNumber(totalDownloads)}
          subtitle={`${from} \u2013 ${to}`}
          loading={podcastLoading}
        />
        <StatCard
          title="Est. Subscribers"
          value={
            scrapedOverview?.estimatedSubscribers != null
              ? formatNumber(scrapedOverview.estimatedSubscribers)
              : "\u2014"
          }
          subtitle={
            scrapedOverview?.scrapedAt
              ? `Updated ${new Date(scrapedOverview.scrapedAt).toLocaleDateString()}`
              : "No data yet"
          }
          loading={podcastLoading}
        />
        <StatCard
          title="YouTube Views"
          value={loading ? "" : formatNumber(ytTotalViews)}
          subtitle={`${from} \u2013 ${to}`}
          loading={ytLoading}
        />
        <StatCard
          title="Watch Hours"
          value={loading ? "" : formatNumber(Math.round(watchHours / 60))}
          subtitle={`${from} \u2013 ${to}`}
          loading={ytLoading}
        />
      </div>

      {/* Time Series Charts */}
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

      {/* Tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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

      {/* Audience Summary */}
      <OverviewAudienceSection
        scrapedOverview={scrapedOverview}
        ytChannel={ytChannel}
        podcastLoading={podcastLoading}
        youtubeLoading={ytLoading}
      />

      {/* Cross-Platform Geography */}
      <OverviewGeoSection
        podcastGeo={scrapedGeo}
        youtubeGeo={ytGeo}
        podcastLoading={podcastLoading}
        youtubeLoading={ytLoading}
      />

      {/* Where People Experience the Show */}
      <OverviewPlatformsSection
        podcastApps={scrapedApps}
        youtubeTotalViews={ytTotalViews}
        podcastLoading={podcastLoading}
        youtubeLoading={ytLoading}
      />
    </div>
  );
}
