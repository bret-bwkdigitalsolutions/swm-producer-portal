"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useDateRange } from "@/components/analytics/date-range-provider";
import ShowSelector from "@/components/analytics/show-selector";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import BarChart from "@/components/analytics/charts/bar-chart";
import DonutChart from "@/components/analytics/charts/donut-chart";
import AreaChart from "@/components/analytics/charts/area-chart";
import VideoTable from "@/components/analytics/video-table";
import {
  fetchAccessibleShows,
  fetchYouTubeChannel,
  fetchYouTubeVideos,
  fetchYouTubeAnalytics,
  fetchYouTubeTraffic,
  fetchYouTubeGeo,
} from "@/app/dashboard/analytics/actions";
import type {
  AccessibleShow,
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
  YouTubeTrafficSource,
  YouTubeCountryData,
} from "@/lib/analytics/types";

export default function YouTubeAnalyticsPage() {
  const { from, to } = useDateRange();
  const searchParams = useSearchParams();
  const router = useRouter();
  const showParam = searchParams.get("show");

  const [shows, setShows] = useState<AccessibleShow[]>([]);
  const [selectedShowId, setSelectedShowId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [channel, setChannel] = useState<YouTubeChannelStats | null>(null);
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [analytics, setAnalytics] = useState<YouTubeAnalyticsPoint[]>([]);
  const [trafficSources, setTrafficSources] = useState<YouTubeTrafficSource[]>([]);
  const [countries, setCountries] = useState<YouTubeCountryData[]>([]);
  const [staticLoading, setStaticLoading] = useState(false);
  const [dateLoading, setDateLoading] = useState(false);

  const handleShowChange = useCallback(
    (wpShowId: number) => {
      setSelectedShowId(wpShowId);
      const params = new URLSearchParams(searchParams.toString());
      params.set("show", String(wpShowId));
      router.replace(`?${params.toString()}`);
    },
    [searchParams, router]
  );

  // Load accessible shows on mount, auto-select first
  useEffect(() => {
    fetchAccessibleShows().then((result) => {
      setShows(result);
      const preselected = showParam ? parseInt(showParam, 10) : null;
      if (preselected && !isNaN(preselected) && result.some((s) => s.wpShowId === preselected)) {
        setSelectedShowId(preselected);
      } else if (result.length > 0) {
        setSelectedShowId(result[0].wpShowId);
      }
      setLoading(false);
    });
  }, [showParam]);

  // Fetch channel stats + videos when show changes (non-date-dependent)
  useEffect(() => {
    if (selectedShowId === null) return;

    setStaticLoading(true);
    Promise.all([
      fetchYouTubeChannel(selectedShowId),
      fetchYouTubeVideos(selectedShowId),
    ]).then(([channelData, videosData]) => {
      setChannel(channelData);
      setVideos(videosData);
      setStaticLoading(false);
    });
  }, [selectedShowId]);

  // Fetch analytics + traffic + geo when show or date range changes
  useEffect(() => {
    if (selectedShowId === null) return;

    setDateLoading(true);
    const dateRange = { from, to };

    Promise.all([
      fetchYouTubeAnalytics(selectedShowId, dateRange),
      fetchYouTubeTraffic(selectedShowId, dateRange),
      fetchYouTubeGeo(selectedShowId, dateRange),
    ]).then(([analyticsData, trafficData, geoData]) => {
      setAnalytics(analyticsData);
      setTrafficSources(trafficData);
      setCountries(geoData);
      setDateLoading(false);
    });
  }, [selectedShowId, from, to]);

  // Computed values
  const totalViews = analytics.reduce((sum, d) => sum + d.views, 0);
  const totalMinutes = analytics.reduce((sum, d) => sum + d.estimatedMinutesWatched, 0);
  const watchHours = Math.round(totalMinutes / 60);
  const subsGained = analytics.reduce((sum, d) => sum + d.subscribersGained, 0);
  const subsLost = analytics.reduce((sum, d) => sum + d.subscribersLost, 0);
  const avgViewDuration = totalViews > 0 ? Math.round(totalMinutes / totalViews) : 0;

  const dataLoading = staticLoading || dateLoading;

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
        <div>
          <h2 className="text-xl font-semibold">YouTube Analytics</h2>
          <p className="text-sm text-muted-foreground">
            Data may be 48–72 hours delayed
          </p>
        </div>
        <ShowSelector
          shows={shows}
          selectedShowId={selectedShowId}
          onChange={handleShowChange}
        />
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Subscribers"
          value={channel ? channel.subscriberCount.toLocaleString() : "—"}
          loading={staticLoading}
        />
        <StatCard
          title="Subs Gained"
          value={subsGained.toLocaleString()}
          loading={dateLoading}
        />
        <StatCard
          title="Subs Lost"
          value={subsLost.toLocaleString()}
          loading={dateLoading}
        />
        <StatCard
          title="Views"
          value={totalViews.toLocaleString()}
          loading={dateLoading}
        />
        <StatCard
          title="Watch Hours"
          value={watchHours.toLocaleString()}
          loading={dateLoading}
        />
        <StatCard
          title="Avg View Duration"
          value={`${avgViewDuration} min`}
          loading={dateLoading}
        />
      </div>

      {/* Views Over Time */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Views Over Time</h2>
        <TimeSeriesChart
          data={analytics as unknown as Record<string, unknown>[]}
          xKey="date"
          series={[{ dataKey: "views", name: "Views", color: "#6366f1" }]}
        />
      </div>

      {/* Watch Time Over Time */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Watch Time Over Time</h2>
        <TimeSeriesChart
          data={analytics as unknown as Record<string, unknown>[]}
          xKey="date"
          series={[
            {
              dataKey: "estimatedMinutesWatched",
              name: "Minutes Watched",
              color: "#8b5cf6",
            },
          ]}
        />
      </div>

      {/* Traffic Sources + Top Countries */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Traffic Sources</h2>
          <DonutChart
            data={trafficSources.map((t) => ({
              name: t.source,
              value: t.views,
            }))}
          />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Top Countries</h2>
          <BarChart
            data={
              countries
                .sort((a, b) => b.views - a.views)
                .slice(0, 10) as unknown as Record<string, unknown>[]
            }
            xKey="country"
            series={[
              { dataKey: "views", name: "Views", color: "#8b5cf6" },
            ]}
            layout="horizontal"
            height={350}
          />
        </div>
      </div>

      {/* Subscribers Gained vs Lost */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">
          Subscribers Gained vs Lost
        </h2>
        <AreaChart
          data={analytics as unknown as Record<string, unknown>[]}
          xKey="date"
          series={[
            {
              dataKey: "subscribersGained",
              name: "Gained",
              color: "#22c55e",
            },
            {
              dataKey: "subscribersLost",
              name: "Lost",
              color: "#ef4444",
            },
          ]}
        />
      </div>

      {/* Recent Videos */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Recent Videos</h2>
        {dataLoading ? (
          <div className="h-48 animate-pulse rounded bg-muted" />
        ) : (
          <VideoTable videos={videos} />
        )}
      </div>
    </div>
  );
}
