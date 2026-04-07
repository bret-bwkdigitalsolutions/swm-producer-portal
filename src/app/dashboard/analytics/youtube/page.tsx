"use client";

import { useEffect, useState } from "react";
import { useDateRange } from "@/components/analytics/date-range-provider";
import { useAnalyticsSelection } from "@/components/analytics/analytics-selection-provider";
import HierarchicalShowSelector from "@/components/analytics/hierarchical-show-selector";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import BarChart from "@/components/analytics/charts/bar-chart";
import DonutChart from "@/components/analytics/charts/donut-chart";
import AreaChart from "@/components/analytics/charts/area-chart";
import VideoTable from "@/components/analytics/video-table";
import {
  fetchAccessibleShows,
  fetchCurrentUserRole,
  fetchYouTubeChannel,
  fetchYouTubeVideos,
  fetchYouTubeAnalytics,
  fetchYouTubeTraffic,
  fetchYouTubeGeo,
  fetchAggregatedYouTubeChannel,
  fetchAggregatedYouTubeVideos,
  fetchAggregatedYouTubeAnalytics,
  fetchAggregatedYouTubeGeo,
  fetchYouTubeDemographics,
  fetchYouTubeSubscription,
  fetchYouTubeDevices,
  fetchYouTubeContentTypes,
  fetchAggregatedYouTubeDemographics,
  fetchAggregatedYouTubeSubscription,
  fetchAggregatedYouTubeDevices,
  fetchAggregatedYouTubeContentTypes,
} from "@/app/dashboard/analytics/actions";
import type {
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
  YouTubeTrafficSource,
  YouTubeCountryData,
  YouTubeDemographic,
  YouTubeSubscriptionStatus,
  YouTubeDeviceType,
  YouTubeContentType,
} from "@/lib/analytics/types";

export default function YouTubeAnalyticsPage() {
  const { from, to } = useDateRange();
  const {
    showsInScope,
    accessibleShows,
    setAccessibleShows,
    setRole,
  } = useAnalyticsSelection();

  const [initialized, setInitialized] = useState(false);
  const [channel, setChannel] = useState<YouTubeChannelStats | null>(null);
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [analytics, setAnalytics] = useState<YouTubeAnalyticsPoint[]>([]);
  const [trafficSources, setTrafficSources] = useState<YouTubeTrafficSource[]>(
    []
  );
  const [countries, setCountries] = useState<YouTubeCountryData[]>([]);
  const [demographics, setDemographics] = useState<YouTubeDemographic[]>([]);
  const [subscriptionStatus, setSubscriptionStatus] = useState<YouTubeSubscriptionStatus[]>([]);
  const [deviceTypes, setDeviceTypes] = useState<YouTubeDeviceType[]>([]);
  const [contentTypes, setContentTypes] = useState<YouTubeContentType[]>([]);
  const [staticLoading, setStaticLoading] = useState(false);
  const [dateLoading, setDateLoading] = useState(false);

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

  // Fetch channel + videos when selection changes
  useEffect(() => {
    if (!initialized || showsInScope.length === 0) return;

    setStaticLoading(true);
    const isSingle = showsInScope.length === 1;

    Promise.all([
      isSingle
        ? fetchYouTubeChannel(showsInScope[0])
        : fetchAggregatedYouTubeChannel(showsInScope),
      isSingle
        ? fetchYouTubeVideos(showsInScope[0])
        : fetchAggregatedYouTubeVideos(showsInScope),
    ]).then(([channelData, videosData]) => {
      setChannel(channelData);
      setVideos(videosData);
      setStaticLoading(false);
    });
  }, [initialized, showsInScope]);

  // Fetch date-dependent data
  useEffect(() => {
    if (!initialized || showsInScope.length === 0) return;

    setDateLoading(true);
    const dateRange = { from, to };
    const isSingle = showsInScope.length === 1;

    Promise.all([
      isSingle
        ? fetchYouTubeAnalytics(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeAnalytics(showsInScope, dateRange),
      isSingle
        ? fetchYouTubeTraffic(showsInScope[0], dateRange)
        : Promise.resolve([]),
      isSingle
        ? fetchYouTubeGeo(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeGeo(showsInScope, dateRange),
      isSingle
        ? fetchYouTubeDemographics(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeDemographics(showsInScope, dateRange),
      isSingle
        ? fetchYouTubeSubscription(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeSubscription(showsInScope, dateRange),
      isSingle
        ? fetchYouTubeDevices(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeDevices(showsInScope, dateRange),
      isSingle
        ? fetchYouTubeContentTypes(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeContentTypes(showsInScope, dateRange),
    ]).then(([analyticsData, trafficData, geoData, demosData, subsData, devicesData, contentData]) => {
      setAnalytics(analyticsData);
      setTrafficSources(trafficData);
      setCountries(geoData);
      setDemographics(demosData);
      setSubscriptionStatus(subsData);
      setDeviceTypes(devicesData);
      setContentTypes(contentData);
      setDateLoading(false);
    });
  }, [initialized, showsInScope, from, to]);

  const totalViews = analytics.reduce((sum, d) => sum + d.views, 0);
  const totalMinutes = analytics.reduce(
    (sum, d) => sum + d.estimatedMinutesWatched,
    0
  );
  const watchHours = Math.round(totalMinutes / 60);
  const subsGained = analytics.reduce(
    (sum, d) => sum + d.subscribersGained,
    0
  );
  const subsLost = analytics.reduce((sum, d) => sum + d.subscribersLost, 0);
  const avgViewDuration =
    totalViews > 0 ? Math.round(totalMinutes / totalViews) : 0;
  const dataLoading = staticLoading || dateLoading;

  const AGE_LABELS: Record<string, string> = {
    "age13-17": "13-17",
    "age18-24": "18-24",
    "age25-34": "25-34",
    "age35-44": "35-44",
    "age45-54": "45-54",
    "age55-64": "55-64",
    "age65-": "65+",
  };

  const GENDER_LABELS: Record<string, string> = {
    male: "Male",
    female: "Female",
    user_specified: "Other",
  };

  const DEVICE_LABELS: Record<string, string> = {
    DESKTOP: "Desktop",
    MOBILE: "Mobile",
    TABLET: "Tablet",
    TV: "TV",
    GAME_CONSOLE: "Console",
    UNKNOWN_PLATFORM: "Other",
  };

  const CONTENT_TYPE_LABELS: Record<string, string> = {
    SHORTS: "Shorts",
    VIDEO_ON_DEMAND: "Videos",
    LIVE_STREAM: "Live",
    UNSPECIFIED: "Other",
  };

  const demoChartData = Object.keys(AGE_LABELS).map((ageGroup) => {
    const row: Record<string, unknown> = { ageGroup: AGE_LABELS[ageGroup] };
    for (const d of demographics) {
      if (d.ageGroup === ageGroup) {
        row[GENDER_LABELS[d.gender] ?? d.gender] = d.viewerPercentage;
      }
    }
    return row;
  });

  if (!initialized) {
    return <p className="text-muted-foreground">Loading shows...</p>;
  }

  if (accessibleShows.length === 0) {
    return <p className="text-muted-foreground">No shows available.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">YouTube Analytics</h2>
          <p className="text-sm text-muted-foreground">
            Data may be 48\u201372 hours delayed
          </p>
        </div>
        <HierarchicalShowSelector />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Subscribers"
          value={channel ? channel.subscriberCount.toLocaleString() : "\u2014"}
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

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Views Over Time</h2>
        <TimeSeriesChart
          data={analytics as unknown as Record<string, unknown>[]}
          xKey="date"
          series={[{ dataKey: "views", name: "Views", color: "#6366f1" }]}
        />
      </div>

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {trafficSources.length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Traffic Sources</h2>
            <DonutChart
              data={trafficSources.map((t) => ({
                name: t.source,
                value: t.views,
              }))}
            />
          </div>
        )}
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Top Countries</h2>
          <BarChart
            data={
              countries
                .sort((a, b) => b.views - a.views)
                .slice(0, 10) as unknown as Record<string, unknown>[]
            }
            xKey="country"
            series={[{ dataKey: "views", name: "Views", color: "#8b5cf6" }]}
            layout="horizontal"
            height={350}
          />
        </div>
      </div>

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
            { dataKey: "subscribersLost", name: "Lost", color: "#ef4444" },
          ]}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Recent Videos</h2>
        {dataLoading ? (
          <div className="h-48 animate-pulse rounded bg-muted" />
        ) : (
          <VideoTable videos={videos} />
        )}
      </div>

      {/* Audience Demographics */}
      {demographics.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Audience Demographics</h2>
          <BarChart
            data={demoChartData as Record<string, unknown>[]}
            xKey="ageGroup"
            series={[
              { dataKey: "Male", name: "Male", color: "#6366f1" },
              { dataKey: "Female", name: "Female", color: "#ec4899" },
              { dataKey: "Other", name: "Other", color: "#a3a3a3" },
            ]}
            stacked
            height={300}
          />
        </div>
      )}

      {/* Subscription, Devices, Content Types — 3-column donut row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {subscriptionStatus.length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Subscription Status</h2>
            <DonutChart
              data={subscriptionStatus.map((s) => ({
                name: s.status === "SUBSCRIBED" ? "Subscribed" : "Not Subscribed",
                value: s.views,
              }))}
            />
          </div>
        )}

        {deviceTypes.length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Device Types</h2>
            <DonutChart
              data={deviceTypes.map((d) => ({
                name: DEVICE_LABELS[d.deviceType] ?? d.deviceType,
                value: d.views,
              }))}
            />
          </div>
        )}

        {contentTypes.length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Content Types</h2>
            <DonutChart
              data={contentTypes
                .filter((c) => c.views > 0)
                .map((c) => ({
                  name: CONTENT_TYPE_LABELS[c.contentType] ?? c.contentType,
                  value: c.views,
                }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
