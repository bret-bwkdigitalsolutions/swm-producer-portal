import { describe, it, expect } from "vitest";
import {
  isRetryableTransistorStatus,
  computeTransistorBackoffMs,
} from "../transistor";

describe("isRetryableTransistorStatus", () => {
  it("retries rate limiting (429) and server errors (5xx)", () => {
    expect(isRetryableTransistorStatus(429)).toBe(true);
    expect(isRetryableTransistorStatus(500)).toBe(true);
    expect(isRetryableTransistorStatus(503)).toBe(true);
  });

  it("does not retry client errors that won't self-heal", () => {
    expect(isRetryableTransistorStatus(400)).toBe(false);
    expect(isRetryableTransistorStatus(401)).toBe(false);
    expect(isRetryableTransistorStatus(404)).toBe(false);
  });
});

describe("computeTransistorBackoffMs", () => {
  it("honors a sane Retry-After header (seconds → ms)", () => {
    expect(computeTransistorBackoffMs(1, "2")).toBe(2000);
    expect(computeTransistorBackoffMs(3, "5")).toBe(5000);
  });

  it("falls back to exponential backoff when Retry-After is missing", () => {
    expect(computeTransistorBackoffMs(1, null)).toBe(1000);
    expect(computeTransistorBackoffMs(2, null)).toBe(2000);
    expect(computeTransistorBackoffMs(3, null)).toBe(4000);
  });

  it("ignores a non-numeric or non-positive Retry-After and adds jitter", () => {
    expect(computeTransistorBackoffMs(1, "soon", 100)).toBe(1100);
    expect(computeTransistorBackoffMs(1, "0", 50)).toBe(1050);
  });
});
