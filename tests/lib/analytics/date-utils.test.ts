import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDateRange, formatDate } from "@/lib/analytics/date-utils";

describe("formatDate", () => {
  it("formats a Date as YYYY-MM-DD", () => {
    const date = new Date(2026, 2, 15); // March 15, 2026
    expect(formatDate(date)).toBe("2026-03-15");
  });
});

describe("getDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29)); // March 29, 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 7 day range", () => {
    const range = getDateRange("7d");
    expect(range.from).toBe("2026-03-22");
    expect(range.to).toBe("2026-03-29");
  });

  it("returns 30 day range", () => {
    const range = getDateRange("30d");
    expect(range.from).toBe("2026-02-27");
    expect(range.to).toBe("2026-03-29");
  });

  it("returns 90 day range", () => {
    const range = getDateRange("90d");
    expect(range.from).toBe("2025-12-29");
    expect(range.to).toBe("2026-03-29");
  });

  it("returns 12 month range", () => {
    const range = getDateRange("12m");
    expect(range.from).toBe("2025-03-29");
    expect(range.to).toBe("2026-03-29");
  });

  it("defaults to 30d for custom preset", () => {
    const range = getDateRange("custom");
    expect(range.from).toBe("2026-02-27");
    expect(range.to).toBe("2026-03-29");
  });
});
