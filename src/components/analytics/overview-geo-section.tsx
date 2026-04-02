"use client";

import BarChart from "@/components/analytics/charts/bar-chart";
import ScrapedDataBadge from "@/components/analytics/scraped-data-badge";
import type { ScrapedGeoEntry } from "@/app/dashboard/analytics/actions";
import type { YouTubeCountryData } from "@/lib/analytics/types";

interface OverviewGeoSectionProps {
  podcastGeo: { data: ScrapedGeoEntry[]; scrapedAt: string | null };
  youtubeGeo: YouTubeCountryData[];
  podcastLoading: boolean;
  youtubeLoading: boolean;
}

function countryCodeToName(code: string): string {
  try {
    const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    return displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}

interface MergedGeoRow {
  country: string;
  downloads: number;
  views: number;
  total: number;
}

function mergeGeoData(
  podcast: ScrapedGeoEntry[],
  youtube: YouTubeCountryData[]
): MergedGeoRow[] {
  const map = new Map<string, MergedGeoRow>();

  for (const entry of podcast) {
    const key = entry.country;
    const existing = map.get(key);
    if (existing) {
      existing.downloads += entry.downloads;
    } else {
      map.set(key, { country: key, downloads: entry.downloads, views: 0, total: 0 });
    }
  }

  for (const entry of youtube) {
    const name = countryCodeToName(entry.country);
    const existing = map.get(name);
    if (existing) {
      existing.views += entry.views;
    } else {
      map.set(name, { country: name, downloads: 0, views: entry.views, total: 0 });
    }
  }

  const rows = Array.from(map.values());
  for (const row of rows) {
    row.total = row.downloads + row.views;
  }
  return rows.sort((a, b) => b.total - a.total);
}

export default function OverviewGeoSection({
  podcastGeo,
  youtubeGeo,
  podcastLoading,
  youtubeLoading,
}: OverviewGeoSectionProps) {
  const loading = podcastLoading || youtubeLoading;

  if (!loading && podcastGeo.data.length === 0 && youtubeGeo.length === 0) {
    return null;
  }

  const merged = mergeGeoData(podcastGeo.data, youtubeGeo);
  const grandTotal = merged.reduce((sum, r) => sum + r.total, 0);
  const top10 = merged.slice(0, 10);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Audience Geography</h2>
        <ScrapedDataBadge scrapedAt={podcastGeo.scrapedAt} />
      </div>

      {loading ? (
        <div className="h-[300px] animate-pulse rounded bg-muted" />
      ) : (
        <div className="space-y-4">
          <BarChart
            data={top10 as unknown as Record<string, unknown>[]}
            xKey="country"
            series={[
              { dataKey: "downloads", name: "Podcast Downloads", color: "#6366f1" },
              { dataKey: "views", name: "YouTube Views", color: "#f43f5e" },
            ]}
            layout="horizontal"
            height={Math.max(200, top10.length * 40)}
            stacked
          />
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Country</th>
                  <th className="pb-2 text-right font-medium">Downloads</th>
                  <th className="pb-2 text-right font-medium">Views</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                  <th className="pb-2 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {merged.map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5">{row.country}</td>
                    <td className="py-1.5 text-right">
                      {row.downloads.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right">
                      {row.views.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right font-medium">
                      {row.total.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {grandTotal > 0
                        ? `${((row.total / grandTotal) * 100).toFixed(1)}%`
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
