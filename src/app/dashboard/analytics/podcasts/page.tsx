"use client";

import { useEffect, useState } from "react";
import { useDateRange } from "@/components/analytics/date-range-provider";
import { useAnalyticsSelection } from "@/components/analytics/analytics-selection-provider";
import HierarchicalShowSelector from "@/components/analytics/hierarchical-show-selector";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import EpisodeTable from "@/components/analytics/episode-table";
import ListenersSection from "@/components/analytics/listeners-section";
import {
  fetchAccessibleShows,
  fetchCurrentUserRole,
  fetchPodcastAnalytics,
  fetchPodcastEpisodes,
  fetchScrapedOverview,
  fetchScrapedGeo,
  fetchScrapedApps,
  fetchScrapedDevices,
  fetchAggregatedPodcastAnalytics,
  fetchAggregatedPodcastEpisodes,
  fetchAggregatedScrapedOverview,
  fetchAggregatedScrapedGeo,
  fetchAggregatedScrapedApps,
} from "@/app/dashboard/analytics/actions";
import type {
  TransistorAnalyticsPoint,
  TransistorEpisode,
} from "@/lib/analytics/types";
import type {
  ScrapedOverviewData,
  ScrapedGeoEntry,
  ScrapedAppEntry,
  ScrapedDeviceEntry,
} from "@/app/dashboard/analytics/actions";

export default function PodcastAnalyticsPage() {
  const { from, to } = useDateRange();
  const {
    showsInScope,
    accessibleShows,
    setAccessibleShows,
    setRole,
  } = useAnalyticsSelection();

  const [initialized, setInitialized] = useState(false);
  const [downloads, setDownloads] = useState<TransistorAnalyticsPoint[]>([]);
  const [episodes, setEpisodes] = useState<TransistorEpisode[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
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
  const [scrapedDevices, setScrapedDevices] = useState<{
    data: ScrapedDeviceEntry[];
    scrapedAt: string | null;
  }>({ data: [], scrapedAt: null });

  // Initialize shows and role
  useEffect(() => {
    if (accessibleShows.length > 0) {
      setInitialized(true);
      return;
    }
    Promise.all([fetchAccessibleShows(), fetchCurrentUserRole()]).then(
      ([shows, userRole]) => {
        setAccessibleShows(shows);
        setRole(userRole);
        setInitialized(true);
      }
    );
  }, [accessibleShows, setAccessibleShows, setRole]);

  // Fetch data when selection or date range changes
  useEffect(() => {
    if (!initialized || showsInScope.length === 0) return;

    setDataLoading(true);
    const dateRange = { from, to };
    const isSingle = showsInScope.length === 1;

    // Core analytics
    Promise.all([
      isSingle
        ? fetchPodcastAnalytics(showsInScope[0], dateRange)
        : fetchAggregatedPodcastAnalytics(showsInScope, dateRange),
      isSingle
        ? fetchPodcastEpisodes(showsInScope[0])
        : fetchAggregatedPodcastEpisodes(showsInScope),
    ])
      .then(([analyticsData, episodesData]) => {
        setDownloads(analyticsData);
        setEpisodes(episodesData);
        setDataLoading(false);
      })
      .catch(() => setDataLoading(false));

    // Scraped data
    if (isSingle) {
      fetchScrapedOverview(showsInScope[0])
        .then(setScrapedOverview)
        .catch(() => {});
      fetchScrapedGeo(showsInScope[0])
        .then(setScrapedGeo)
        .catch(() => {});
      fetchScrapedApps(showsInScope[0])
        .then(setScrapedApps)
        .catch(() => {});
      fetchScrapedDevices(showsInScope[0])
        .then(setScrapedDevices)
        .catch(() => {});
    } else {
      fetchAggregatedScrapedOverview(showsInScope)
        .then(setScrapedOverview)
        .catch(() => {});
      fetchAggregatedScrapedGeo(showsInScope)
        .then(setScrapedGeo)
        .catch(() => {});
      fetchAggregatedScrapedApps(showsInScope)
        .then(setScrapedApps)
        .catch(() => {});
      // No aggregated devices action — reset
      setScrapedDevices({ data: [], scrapedAt: null });
    }
  }, [initialized, showsInScope, from, to]);

  const totalDownloads = downloads.reduce((sum, d) => sum + d.downloads, 0);
  const avgPerEpisode =
    episodes.length > 0 ? Math.round(totalDownloads / episodes.length) : 0;

  if (!initialized) {
    return <p className="text-muted-foreground">Loading shows...</p>;
  }

  if (accessibleShows.length === 0) {
    return <p className="text-muted-foreground">No shows available.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Podcast Analytics</h2>
        <HierarchicalShowSelector />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard
          title="Total Downloads"
          value={totalDownloads.toLocaleString()}
          loading={dataLoading}
        />
        <StatCard
          title="Avg per Episode"
          value={avgPerEpisode.toLocaleString()}
          loading={dataLoading}
        />
        <StatCard
          title="Episodes Published"
          value={episodes.length.toLocaleString()}
          loading={dataLoading}
        />
        <StatCard
          title="Est. Subscribers"
          value={
            scrapedOverview?.estimatedSubscribers?.toLocaleString() ?? "\u2014"
          }
          subtitle={
            scrapedOverview?.scrapedAt
              ? `Updated ${new Date(scrapedOverview.scrapedAt).toLocaleDateString()}`
              : undefined
          }
          loading={dataLoading}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Downloads Over Time</h2>
        <TimeSeriesChart
          data={downloads as unknown as Record<string, unknown>[]}
          xKey="date"
          series={[
            { dataKey: "downloads", name: "Downloads", color: "#6366f1" },
          ]}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Episodes</h2>
        <EpisodeTable episodes={episodes} />
      </div>

      <ListenersSection
        geo={scrapedGeo}
        apps={scrapedApps}
        devices={scrapedDevices}
        loading={dataLoading}
      />
    </div>
  );
}
