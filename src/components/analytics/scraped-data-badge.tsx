import { formatDistanceToNow } from "date-fns";

interface ScrapedDataBadgeProps {
  scrapedAt: string | null;
  warnAfterDays?: number;
}

export default function ScrapedDataBadge({
  scrapedAt,
  warnAfterDays = 10,
}: ScrapedDataBadgeProps) {
  if (!scrapedAt) {
    return (
      <span className="text-xs text-muted-foreground">No data yet</span>
    );
  }

  const daysSince = Math.floor(
    (Date.now() - new Date(scrapedAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  const isStale = daysSince > warnAfterDays;

  return (
    <span
      className={`text-xs ${isStale ? "text-amber-500 font-medium" : "text-muted-foreground"}`}
    >
      Updated {formatDistanceToNow(new Date(scrapedAt), { addSuffix: true })}
      {isStale && " (stale)"}
    </span>
  );
}
