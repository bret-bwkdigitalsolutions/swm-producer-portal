import Link from "next/link";
import { formatNumber } from "@/lib/analytics/date-utils";
import type { NetworkShowBreakdown } from "@/app/dashboard/analytics/network/actions";
import type { AccessibleShow } from "@/lib/analytics/types";

interface ShowBreakdownTableProps {
  breakdown: NetworkShowBreakdown[];
  shows: AccessibleShow[];
}

export default function ShowBreakdownTable({
  breakdown,
  shows,
}: ShowBreakdownTableProps) {
  const showTitleMap = new Map(shows.map((s) => [s.wpShowId, s.title]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="px-4 py-3 font-medium">Show</th>
            <th className="px-4 py-3 font-medium">Downloads</th>
            <th className="px-4 py-3 font-medium">Episodes</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((row) => (
            <tr key={row.wpShowId} className="border-b hover:bg-muted/50">
              <td className="px-4 py-3">
                <Link
                  href={`/dashboard/analytics?show=${row.wpShowId}`}
                  className="text-primary hover:underline"
                >
                  {showTitleMap.get(row.wpShowId) ?? `Show #${row.wpShowId}`}
                </Link>
              </td>
              <td className="px-4 py-3">{formatNumber(row.totalDownloads)}</td>
              <td className="px-4 py-3">{formatNumber(row.episodeCount)}</td>
            </tr>
          ))}
          {breakdown.length === 0 && (
            <tr>
              <td
                colSpan={3}
                className="py-8 text-center text-muted-foreground"
              >
                No show data available.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
