"use client";

import DonutChart from "@/components/analytics/charts/donut-chart";
import ScrapedDataBadge from "@/components/analytics/scraped-data-badge";
import type { ScrapedAppEntry } from "@/app/dashboard/analytics/actions";

interface OverviewPlatformsSectionProps {
  podcastApps: { data: ScrapedAppEntry[]; scrapedAt: string | null };
  youtubeTotalViews: number;
  podcastLoading: boolean;
  youtubeLoading: boolean;
}

interface PlatformRow {
  name: string;
  value: number;
}

function mergePlatformData(
  apps: ScrapedAppEntry[],
  ytViews: number
): PlatformRow[] {
  const rows: PlatformRow[] = apps.map((a) => ({
    name: a.appName,
    value: a.downloads,
  }));

  if (ytViews > 0) {
    rows.push({ name: "YouTube", value: ytViews });
  }

  return rows.sort((a, b) => b.value - a.value);
}

export default function OverviewPlatformsSection({
  podcastApps,
  youtubeTotalViews,
  podcastLoading,
  youtubeLoading,
}: OverviewPlatformsSectionProps) {
  const loading = podcastLoading || youtubeLoading;

  if (!loading && podcastApps.data.length === 0 && youtubeTotalViews === 0) {
    return null;
  }

  const merged = mergePlatformData(podcastApps.data, youtubeTotalViews);
  const grandTotal = merged.reduce((sum, r) => sum + r.value, 0);
  const donutData = merged.slice(0, 8);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">
          Where People Experience the Show
        </h2>
        <ScrapedDataBadge scrapedAt={podcastApps.scrapedAt} />
      </div>

      {loading ? (
        <div className="h-[300px] animate-pulse rounded bg-muted" />
      ) : (
        <div className="space-y-4">
          <DonutChart data={donutData} />
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Platform</th>
                  <th className="pb-2 text-right font-medium">
                    Listens / Views
                  </th>
                  <th className="pb-2 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {merged.map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5">{row.name}</td>
                    <td className="py-1.5 text-right">
                      {row.value.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {grandTotal > 0
                        ? `${((row.value / grandTotal) * 100).toFixed(1)}%`
                        : "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
