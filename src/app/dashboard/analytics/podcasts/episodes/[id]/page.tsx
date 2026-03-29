"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useDateRange } from "@/components/analytics/date-range-provider";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import { formatNumber } from "@/lib/analytics/date-utils";
import { fetchEpisodeAnalytics, fetchAccessibleShows } from "@/app/dashboard/analytics/actions";
import type { TransistorAnalyticsPoint } from "@/lib/analytics/types";

export default function EpisodeDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const episodeId = params.id as string;
  const showParam = searchParams.get("show");
  const { from, to } = useDateRange();

  const [wpShowId, setWpShowId] = useState<number | null>(
    showParam ? Number(showParam) : null
  );
  const [downloads, setDownloads] = useState<TransistorAnalyticsPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Resolve wpShowId if not in search params
  useEffect(() => {
    if (wpShowId) return;
    fetchAccessibleShows().then((shows) => {
      if (shows.length > 0) setWpShowId(shows[0].wpShowId);
    });
  }, [wpShowId]);

  const fetchData = useCallback(async () => {
    if (!wpShowId || !episodeId) return;
    setLoading(true);
    setError(null);

    try {
      const data = await fetchEpisodeAnalytics(wpShowId, episodeId, { from, to });
      setDownloads(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [wpShowId, episodeId, from, to]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalDownloads = downloads.reduce((sum, d) => sum + d.downloads, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/analytics/podcasts"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to Podcasts
        </Link>
        <h2 className="text-xl font-bold">Episode Analytics</h2>
      </div>

      {error && (
        <div className="text-sm text-destructive text-center">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Total Downloads"
          value={formatNumber(totalDownloads)}
          subtitle={`${from} to ${to}`}
          loading={loading}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-4 text-lg font-semibold">Downloads Over Time</h3>
        {loading ? (
          <div className="flex h-[300px] items-center justify-center">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <TimeSeriesChart
            data={downloads}
            xKey="date"
            series={[
              { dataKey: "downloads", name: "Downloads", color: "#6366f1" },
            ]}
          />
        )}
      </div>
    </div>
  );
}
