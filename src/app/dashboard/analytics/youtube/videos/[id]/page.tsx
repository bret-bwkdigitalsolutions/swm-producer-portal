"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useDateRange } from "@/components/analytics/date-range-provider";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import { formatNumber } from "@/lib/analytics/date-utils";
import {
  fetchYouTubeVideoDetail,
  fetchAccessibleShows,
} from "@/app/dashboard/analytics/actions";
import type { YouTubeAnalyticsPoint } from "@/lib/analytics/types";

export default function VideoDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const videoId = params.id as string;
  const showParam = searchParams.get("show");
  const { from, to } = useDateRange();

  const [wpShowId, setWpShowId] = useState<number | null>(
    showParam ? Number(showParam) : null
  );
  const [analytics, setAnalytics] = useState<YouTubeAnalyticsPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wpShowId) return;
    fetchAccessibleShows().then((shows) => {
      if (shows.length > 0) setWpShowId(shows[0].wpShowId);
    });
  }, [wpShowId]);

  const fetchData = useCallback(async () => {
    if (!wpShowId || !videoId) return;
    setLoading(true);
    setError(null);

    try {
      const data = await fetchYouTubeVideoDetail(wpShowId, videoId, {
        from,
        to,
      });
      setAnalytics(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load analytics"
      );
    } finally {
      setLoading(false);
    }
  }, [wpShowId, videoId, from, to]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalViews = analytics.reduce((sum, d) => sum + d.views, 0);
  const totalMinutes = analytics.reduce(
    (sum, d) => sum + d.estimatedMinutesWatched,
    0
  );
  const watchHours = Math.round(totalMinutes / 60);
  const avgDuration =
    totalViews > 0 ? Math.round(totalMinutes / totalViews) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/analytics/youtube"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; Back to YouTube
          </Link>
          <h2 className="text-xl font-bold">Video Analytics</h2>
        </div>
        <a
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline"
        >
          View on YouTube
        </a>
      </div>

      {error && (
        <div className="text-sm text-destructive text-center">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Views"
          value={formatNumber(totalViews)}
          subtitle={`${from} to ${to}`}
          loading={loading}
        />
        <StatCard
          title="Watch Hours"
          value={formatNumber(watchHours)}
          loading={loading}
        />
        <StatCard
          title="Avg View Duration"
          value={`${avgDuration} min`}
          loading={loading}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-4 text-lg font-semibold">Views Over Time</h3>
        {loading ? (
          <div className="flex h-[300px] items-center justify-center">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <TimeSeriesChart
            data={analytics as unknown as Record<string, unknown>[]}
            xKey="date"
            series={[
              { dataKey: "views", name: "Views", color: "#6366f1" },
            ]}
          />
        )}
      </div>
    </div>
  );
}
