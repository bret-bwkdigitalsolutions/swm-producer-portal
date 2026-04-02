"use client";

import { useEffect, useState } from "react";
import { useDateRange } from "@/components/analytics/date-range-provider";
import { useAnalyticsSelection } from "@/components/analytics/analytics-selection-provider";
import HierarchicalShowSelector from "@/components/analytics/hierarchical-show-selector";
import BarChart from "@/components/analytics/charts/bar-chart";
import AreaChart from "@/components/analytics/charts/area-chart";
import {
  fetchAccessibleShows,
  fetchCurrentUserRole,
  fetchPodcastAnalytics,
  fetchPodcastEpisodes,
  fetchAggregatedPodcastAnalytics,
  fetchAggregatedPodcastEpisodes,
} from "@/app/dashboard/analytics/actions";
import { formatNumber } from "@/lib/analytics/date-utils";
import { NETWORKS } from "@/lib/analytics/networks";
import type {
  TransistorAnalyticsPoint,
} from "@/lib/analytics/types";

const COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#3b82f6",
  "#06b6d4",
  "#14b8a6",
  "#22c55e",
  "#eab308",
];

interface CompareItem {
  key: string;
  title: string;
  totalDownloads: number;
  episodeCount: number;
  avgPerEpisode: number;
  dailyData: TransistorAnalyticsPoint[];
}

export default function ComparePage() {
  const { from, to } = useDateRange();
  const {
    selection,
    showsInScope,
    accessibleShows,
    setAccessibleShows,
    setRole,
  } = useAnalyticsSelection();

  const [initialized, setInitialized] = useState(false);
  const [items, setItems] = useState<CompareItem[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Initialize
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

  // Fetch comparison data
  useEffect(() => {
    if (!initialized || showsInScope.length === 0) return;

    setDataLoading(true);
    const dateRange = { from, to };

    if (selection.level === "all") {
      // Compare networks against each other
      const networkTasks = NETWORKS.map(async (network) => {
        const networkShowIds = network.wpShowIds.filter((id) =>
          showsInScope.includes(id)
        );
        if (networkShowIds.length === 0) return null;

        const [dailyData, episodes] = await Promise.all([
          networkShowIds.length === 1
            ? fetchPodcastAnalytics(networkShowIds[0], dateRange)
            : fetchAggregatedPodcastAnalytics(networkShowIds, dateRange),
          networkShowIds.length === 1
            ? fetchPodcastEpisodes(networkShowIds[0])
            : fetchAggregatedPodcastEpisodes(networkShowIds),
        ]);

        const totalDownloads = dailyData.reduce(
          (sum, d) => sum + d.downloads,
          0
        );
        const episodeCount = episodes.length;

        return {
          key: network.slug,
          title: network.name,
          totalDownloads,
          episodeCount,
          avgPerEpisode:
            episodeCount > 0 ? Math.round(totalDownloads / episodeCount) : 0,
          dailyData,
        } satisfies CompareItem;
      });

      Promise.all(networkTasks).then((results) => {
        setItems(results.filter((r): r is CompareItem => r !== null));
        setDataLoading(false);
      });
    } else {
      // Compare individual shows (network or show level)
      const showTasks = showsInScope.map(async (wpShowId) => {
        const show = accessibleShows.find((s) => s.wpShowId === wpShowId);
        const [analyticsResult, episodesResult] = await Promise.allSettled([
          fetchPodcastAnalytics(wpShowId, dateRange),
          fetchPodcastEpisodes(wpShowId),
        ]);

        const dailyData =
          analyticsResult.status === "fulfilled" ? analyticsResult.value : [];
        const episodes =
          episodesResult.status === "fulfilled" ? episodesResult.value : [];

        const totalDownloads = dailyData.reduce(
          (sum, d) => sum + d.downloads,
          0
        );
        const episodeCount = episodes.length;

        return {
          key: String(wpShowId),
          title: show?.title ?? `Show #${wpShowId}`,
          totalDownloads,
          episodeCount,
          avgPerEpisode:
            episodeCount > 0 ? Math.round(totalDownloads / episodeCount) : 0,
          dailyData,
        } satisfies CompareItem;
      });

      Promise.all(showTasks).then((results) => {
        setItems(results);
        setDataLoading(false);
      });
    }
  }, [initialized, selection, showsInScope, accessibleShows, from, to]);

  const buildBarData = () =>
    items.map((item) => ({
      name: item.title,
      downloads: item.totalDownloads,
    }));

  const buildStackedData = () => {
    const dateMap: Record<string, Record<string, number>> = {};
    items.forEach((item) => {
      item.dailyData.forEach((point) => {
        if (!dateMap[point.date]) dateMap[point.date] = {};
        dateMap[point.date][item.title] = point.downloads;
      });
    });

    return Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => {
        const entry: Record<string, string | number> = { date };
        items.forEach((item) => {
          entry[item.title] = values[item.title] || 0;
        });
        return entry;
      });
  };

  if (!initialized) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  const compareLabel =
    selection.level === "all" ? "Network Comparison" : "Show Comparison";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{compareLabel}</h2>
        <HierarchicalShowSelector />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-4 text-base font-semibold">Total Downloads</h3>
        {dataLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <BarChart
            data={buildBarData() as unknown as Record<string, unknown>[]}
            xKey="name"
            series={items.map((item, i) => ({
              dataKey: "downloads",
              name: item.title,
              color: COLORS[i % COLORS.length],
            }))}
            layout="vertical"
            height={Math.max(300, items.length * 60)}
          />
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-4 text-base font-semibold">Downloads Over Time</h3>
        {dataLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <AreaChart
            data={buildStackedData() as unknown as Record<string, unknown>[]}
            xKey="date"
            series={items.map((item, i) => ({
              dataKey: item.title,
              name: item.title,
              color: COLORS[i % COLORS.length],
            }))}
            stacked
            height={350}
          />
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-4 text-base font-semibold">Summary</h3>
        {dataLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="pb-2 font-medium">
                  {selection.level === "all" ? "Network" : "Show"}
                </th>
                <th className="pb-2 font-medium">Total Downloads</th>
                <th className="pb-2 font-medium">Episodes</th>
                <th className="pb-2 font-medium">Avg per Episode</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.key} className="border-b hover:bg-muted/50">
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full shrink-0"
                        style={{
                          backgroundColor: COLORS[i % COLORS.length],
                        }}
                      />
                      {item.title}
                    </span>
                  </td>
                  <td className="py-2">{formatNumber(item.totalDownloads)}</td>
                  <td className="py-2">{formatNumber(item.episodeCount)}</td>
                  <td className="py-2">{formatNumber(item.avgPerEpisode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
