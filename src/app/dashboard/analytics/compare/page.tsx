"use client";

import { useEffect, useState } from "react";
import { useDateRange } from "@/components/analytics/date-range-provider";
import BarChart from "@/components/analytics/charts/bar-chart";
import AreaChart from "@/components/analytics/charts/area-chart";
import {
  fetchAccessibleShows,
  fetchPodcastAnalytics,
  fetchPodcastEpisodes,
} from "@/app/dashboard/analytics/actions";
import { formatNumber } from "@/lib/analytics/date-utils";
import type {
  AccessibleShow,
  TransistorAnalyticsPoint,
} from "@/lib/analytics/types";

const SHOW_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#3b82f6",
  "#06b6d4",
  "#14b8a6",
  "#22c55e",
  "#eab308",
];

interface ShowData {
  wpShowId: number;
  title: string;
  totalDownloads: number;
  episodeCount: number;
  avgPerEpisode: number;
  dailyData: TransistorAnalyticsPoint[];
}

export default function ComparePage() {
  const { from, to } = useDateRange();

  const [shows, setShows] = useState<AccessibleShow[]>([]);
  const [showsData, setShowsData] = useState<ShowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);

  // Load accessible shows on mount
  useEffect(() => {
    fetchAccessibleShows().then((result) => {
      setShows(result);
      setLoading(false);
    });
  }, []);

  // Fetch analytics + episodes for all shows when shows or date range changes
  useEffect(() => {
    if (shows.length === 0) return;

    setDataLoading(true);
    const dateRange = { from, to };

    const tasks = shows.map((show) =>
      Promise.allSettled([
        fetchPodcastAnalytics(show.wpShowId, dateRange),
        fetchPodcastEpisodes(show.wpShowId),
      ]).then(([analyticsResult, episodesResult]) => {
        const dailyData =
          analyticsResult.status === "fulfilled" ? analyticsResult.value : [];
        const episodes =
          episodesResult.status === "fulfilled" ? episodesResult.value : [];
        const totalDownloads = dailyData.reduce(
          (sum, d) => sum + d.downloads,
          0
        );
        const episodeCount = episodes.length;
        const avgPerEpisode =
          episodeCount > 0 ? Math.round(totalDownloads / episodeCount) : 0;

        return {
          wpShowId: show.wpShowId,
          title: show.title,
          totalDownloads,
          episodeCount,
          avgPerEpisode,
          dailyData,
        } satisfies ShowData;
      })
    );

    Promise.all(tasks).then((results) => {
      setShowsData(results);
      setDataLoading(false);
    });
  }, [shows, from, to]);

  const buildBarData = () =>
    showsData.map((sd) => ({
      show: sd.title,
      downloads: sd.totalDownloads,
    }));

  const buildStackedData = () => {
    const dateMap: Record<string, Record<string, number>> = {};

    showsData.forEach((sd) => {
      sd.dailyData.forEach((point) => {
        if (!dateMap[point.date]) dateMap[point.date] = {};
        dateMap[point.date][sd.title] = point.downloads;
      });
    });

    return Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => {
        const entry: Record<string, string | number> = { date };
        showsData.forEach((sd) => {
          entry[sd.title] = values[sd.title] || 0;
        });
        return entry;
      });
  };

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

  const barData = buildBarData();
  const stackedData = buildStackedData();
  const areaSeries = showsData.map((sd, i) => ({
    dataKey: sd.title,
    name: sd.title,
    color: SHOW_COLORS[i % SHOW_COLORS.length],
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <h2 className="text-xl font-semibold">Show Comparison</h2>

      {/* Total Downloads by Show */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-4 text-base font-semibold">Total Downloads by Show</h3>
        {dataLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <BarChart
            data={barData as unknown as Record<string, unknown>[]}
            xKey="show"
            series={showsData.map((sd, i) => ({
              dataKey: "downloads",
              name: sd.title,
              color: SHOW_COLORS[i % SHOW_COLORS.length],
            }))}
            layout="vertical"
            height={Math.max(300, showsData.length * 60)}
          />
        )}
      </div>

      {/* Downloads Over Time */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-4 text-base font-semibold">Downloads Over Time</h3>
        {dataLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <AreaChart
            data={stackedData as unknown as Record<string, unknown>[]}
            xKey="date"
            series={areaSeries}
            stacked
            height={350}
          />
        )}
      </div>

      {/* Summary Table */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-4 text-base font-semibold">Summary</h3>
        {dataLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="pb-2 font-medium">Show</th>
                <th className="pb-2 font-medium">Total Downloads</th>
                <th className="pb-2 font-medium">Episodes</th>
                <th className="pb-2 font-medium">Avg per Episode</th>
              </tr>
            </thead>
            <tbody>
              {showsData.map((sd, i) => (
                <tr key={sd.wpShowId} className="border-b hover:bg-muted/50">
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full shrink-0"
                        style={{
                          backgroundColor: SHOW_COLORS[i % SHOW_COLORS.length],
                        }}
                      />
                      {sd.title}
                    </span>
                  </td>
                  <td className="py-2">{formatNumber(sd.totalDownloads)}</td>
                  <td className="py-2">{formatNumber(sd.episodeCount)}</td>
                  <td className="py-2">{formatNumber(sd.avgPerEpisode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
