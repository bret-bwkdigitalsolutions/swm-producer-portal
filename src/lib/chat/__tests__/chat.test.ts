import { describe, it, expect } from "vitest";
import { formatCentral } from "../types";

describe("formatCentral", () => {
  it("formats an already-Central timestamp without any timezone shift", () => {
    // 14:03 must stay 2:03 PM — no conversion.
    expect(formatCentral("2026-08-05 14:03:11")).toBe("Aug 5, 2026, 2:03 PM CT");
  });

  it("handles midnight and noon boundaries", () => {
    expect(formatCentral("2026-01-01 00:00:00")).toBe("Jan 1, 2026, 12:00 AM CT");
    expect(formatCentral("2026-12-31 12:00:00")).toBe("Dec 31, 2026, 12:00 PM CT");
  });

  it("accepts ISO 'T' separators and missing seconds", () => {
    expect(formatCentral("2026-08-05T09:30")).toBe("Aug 5, 2026, 9:30 AM CT");
  });

  it("returns a dash for empty input and echoes unparseable strings", () => {
    expect(formatCentral(null)).toBe("—");
    expect(formatCentral("")).toBe("—");
    expect(formatCentral("not a date")).toBe("not a date");
  });
});
