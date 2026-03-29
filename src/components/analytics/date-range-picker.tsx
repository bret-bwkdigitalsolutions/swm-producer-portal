"use client";

import { useDateRange } from "./date-range-provider";
import type { DateRangePreset } from "@/lib/analytics/types";

const presets: { value: DateRangePreset; label: string }[] = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "12m", label: "12 Months" },
];

export default function DateRangePicker() {
  const { preset, from, to, setPreset, setCustomRange } = useDateRange();

  return (
    <div className="flex items-center gap-2">
      {presets.map((p) => (
        <button
          key={p.value}
          onClick={() => setPreset(p.value)}
          className={`rounded px-3 py-1 text-xs transition-colors ${
            preset === p.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-accent"
          }`}
        >
          {p.label}
        </button>
      ))}

      <div className="ml-2 flex items-center gap-1">
        <input
          type="date"
          value={from}
          onChange={(e) => setCustomRange(e.target.value, to)}
          className="rounded border bg-background px-2 py-1 text-xs"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setCustomRange(from, e.target.value)}
          className="rounded border bg-background px-2 py-1 text-xs"
        />
      </div>
    </div>
  );
}
