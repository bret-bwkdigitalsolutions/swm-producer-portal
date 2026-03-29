import { format, subDays, subMonths } from "date-fns";
import type { DateRangePreset, DateRange } from "./types";

export function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(num);
}

export function getDateRange(preset: DateRangePreset): DateRange {
  const end = new Date();
  let start: Date;

  switch (preset) {
    case "7d":
      start = subDays(end, 7);
      break;
    case "30d":
      start = subDays(end, 30);
      break;
    case "90d":
      start = subDays(end, 90);
      break;
    case "12m":
      start = subMonths(end, 12);
      break;
    default:
      start = subDays(end, 30);
  }

  return { from: formatDate(start), to: formatDate(end) };
}
