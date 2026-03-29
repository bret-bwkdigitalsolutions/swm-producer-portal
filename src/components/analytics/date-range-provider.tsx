"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { getDateRange } from "@/lib/analytics/date-utils";
import type { DateRangePreset } from "@/lib/analytics/types";

interface DateRangeContextType {
  preset: DateRangePreset;
  from: string;
  to: string;
  setPreset: (preset: DateRangePreset) => void;
  setCustomRange: (from: string, to: string) => void;
}

const DateRangeContext = createContext<DateRangeContextType | null>(null);

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx)
    throw new Error("useDateRange must be used within DateRangeProvider");
  return ctx;
}

export default function DateRangeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [preset, setPresetState] = useState<DateRangePreset>("30d");
  const defaultRange = getDateRange("30d");
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);

  function setPreset(p: DateRangePreset) {
    setPresetState(p);
    if (p !== "custom") {
      const range = getDateRange(p);
      setFrom(range.from);
      setTo(range.to);
    }
  }

  function setCustomRange(newFrom: string, newTo: string) {
    setPresetState("custom");
    setFrom(newFrom);
    setTo(newTo);
  }

  return (
    <DateRangeContext.Provider
      value={{ preset, from, to, setPreset, setCustomRange }}
    >
      {children}
    </DateRangeContext.Provider>
  );
}
