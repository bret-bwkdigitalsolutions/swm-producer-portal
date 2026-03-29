"use client";

import type { AccessibleShow } from "@/lib/analytics/types";

interface ShowSelectorProps {
  shows: AccessibleShow[];
  selectedShowId: number | null;
  onChange: (wpShowId: number) => void;
}

export default function ShowSelector({
  shows,
  selectedShowId,
  onChange,
}: ShowSelectorProps) {
  if (shows.length <= 1) return null;

  return (
    <select
      value={selectedShowId ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {shows.map((show) => (
        <option key={show.wpShowId} value={show.wpShowId}>
          {show.title}
        </option>
      ))}
    </select>
  );
}
