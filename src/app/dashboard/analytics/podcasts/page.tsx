"use client";

import { useEffect, useState } from "react";
import { useDateRange } from "@/components/analytics/date-range-provider";
import ShowSelector from "@/components/analytics/show-selector";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import EpisodeTable from "@/components/analytics/episode-table";
import {
  fetchAccessibleShows,
  fetchPodcastAnalytics,
  fetchPodcastEpisodes,
} from "@/app/dashboard/analytics/actions";
import type {
  AccessibleShow,
  TransistorAnalyticsPoint,
  TransistorEpisode,
} from "@/lib/analytics/types";

export default function PodcastAnalyticsPage() {
  const { from, to } = useDateRange();

  const [shows, setShows] = useState<AccessibleShow[]>([]);
  const [selectedShowId, setSelectedShowId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [downloads, setDownloads] = useState<TransistorAnalyticsPoint[]>([]);
  const [episodes, setEpisodes] = useState<TransistorEpisode[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Load accessible shows on mount
  useEffect(() => {
    fetchAccessibleShows().then((result) => {
      setShows(result);
      if (result.length > 0) {
        setSelectedShowId(result[0].wpShowId);
      }
      setLoading(false);
    });
  }, []);

  // Fetch all data when show or date range changes
  useEffect(() => {
    if (selectedShowId === null) return;

    setDataLoading(true);
    const dateRange = { from, to };

    Promise.all([
      fetchPodcastAnalytics(selectedShowId, dateRange),
      fetchPodcastEpisodes(selectedShowId),
    ]).then(([analyticsData, episodesData]) => {
      setDownloads(analyticsData);
      setEpisodes(episodesData);
      setDataLoading(false);
    });
  }, [selectedShowId, from, to]);

  const totalDownloads = downloads.reduce((sum, d) => sum + d.downloads, 0);
  const avgPerEpisode =
    episodes.length > 0 ? Math.round(totalDownloads / episodes.length) : 0;

  if (loading) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Loading shows...</p>
      </div>
    );
  }

  if (shows.length === 0) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">No shows available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Podcast Analytics</h2>
        <ShowSelector
          shows={shows}
          selectedShowId={selectedShowId}
          onChange={setSelectedShowId}
        />
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
      </div>

      {/* Downloads Over Time */}
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

      {/* Episode Table */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Episodes</h2>
        <EpisodeTable episodes={episodes} />
      </div>
    </div>
  );
}
