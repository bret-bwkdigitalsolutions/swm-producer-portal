import { describe, expect, it } from "vitest";
import { evaluateBroadcastDuration } from "@/lib/live-marks/duration";
import { isLiveTranscriptionEnabled } from "@/lib/live-marks/retry";

const start = new Date("2026-10-07T18:00:00.000Z");

function endedAfter(seconds: number): Date {
  return new Date(start.getTime() + seconds * 1000);
}

describe("evaluateBroadcastDuration", () => {
  it("accepts a broadcast strictly between 2 minutes and 4 hours", () => {
    expect(evaluateBroadcastDuration(start, endedAfter(121)).ok).toBe(true);
    expect(evaluateBroadcastDuration(start, endedAfter(3 * 60 * 60)).ok).toBe(true);
  });

  it("skips a broadcast that is 2 minutes or shorter, or 4 hours or longer", () => {
    expect(evaluateBroadcastDuration(start, endedAfter(120)).ok).toBe(false);
    expect(evaluateBroadcastDuration(start, endedAfter(4 * 60 * 60)).ok).toBe(false);
    expect(evaluateBroadcastDuration(start, null).ok).toBe(false);
  });
});

describe("isLiveTranscriptionEnabled", () => {
  it("defaults to on", () => {
    expect(isLiveTranscriptionEnabled(undefined)).toBe(true);
    expect(isLiveTranscriptionEnabled("")).toBe(true);
    expect(isLiveTranscriptionEnabled("true")).toBe(true);
  });

  it("turns off for the documented false values", () => {
    expect(isLiveTranscriptionEnabled("false")).toBe(false);
    expect(isLiveTranscriptionEnabled("0")).toBe(false);
    expect(isLiveTranscriptionEnabled("off")).toBe(false);
  });
});
