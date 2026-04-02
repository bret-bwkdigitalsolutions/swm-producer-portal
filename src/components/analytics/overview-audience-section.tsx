"use client";

import { formatNumber } from "@/lib/analytics/date-utils";
import type { ScrapedOverviewData } from "@/app/dashboard/analytics/actions";
import type { YouTubeChannelStats } from "@/lib/analytics/types";

interface OverviewAudienceSectionProps {
  scrapedOverview: ScrapedOverviewData | null;
  ytChannel: YouTubeChannelStats | null;
  podcastLoading: boolean;
  youtubeLoading: boolean;
}

export default function OverviewAudienceSection({
  scrapedOverview,
  ytChannel,
  podcastLoading,
  youtubeLoading,
}: OverviewAudienceSectionProps) {
  const podSubs = scrapedOverview?.estimatedSubscribers ?? null;
  const ytSubs = ytChannel?.subscriberCount ?? null;
  const combinedAudience =
    podSubs != null || ytSubs != null ? (podSubs ?? 0) + (ytSubs ?? 0) : null;

  const loading = podcastLoading || youtubeLoading;

  const avgDownloads = [
    { label: "7-day avg", value: scrapedOverview?.avgDownloads7d },
    { label: "30-day avg", value: scrapedOverview?.avgDownloads30d },
    { label: "60-day avg", value: scrapedOverview?.avgDownloads60d },
    { label: "90-day avg", value: scrapedOverview?.avgDownloads90d },
  ];

  const hasAvgData = avgDownloads.some((d) => d.value != null);

  if (!loading && podSubs == null && ytSubs == null && !hasAvgData) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="mb-4 text-base font-semibold">Audience Summary</h2>

      {loading ? (
        <div className="h-24 animate-pulse rounded bg-muted" />
      ) : (
        <div className="space-y-4">
          {/* Subscriber counts */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">
                Podcast Subscribers
              </p>
              <p className="mt-1 text-2xl font-bold">
                {podSubs != null ? formatNumber(podSubs) : "\u2014"}
              </p>
              <p className="text-xs text-muted-foreground">Estimated</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                YouTube Subscribers
              </p>
              <p className="mt-1 text-2xl font-bold">
                {ytSubs != null ? formatNumber(ytSubs) : "\u2014"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Combined Audience</p>
              <p className="mt-1 text-2xl font-bold">
                {combinedAudience != null
                  ? formatNumber(combinedAudience)
                  : "\u2014"}
              </p>
            </div>
          </div>

          {/* Average downloads */}
          {hasAvgData && (
            <div>
              <p className="mb-2 text-sm text-muted-foreground">
                Avg Downloads per Episode
              </p>
              <div className="grid grid-cols-4 gap-4">
                {avgDownloads.map((d) => (
                  <div
                    key={d.label}
                    className="rounded-lg border bg-muted/30 px-3 py-2 text-center"
                  >
                    <p className="text-lg font-semibold">
                      {d.value != null ? formatNumber(d.value) : "\u2014"}
                    </p>
                    <p className="text-xs text-muted-foreground">{d.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
