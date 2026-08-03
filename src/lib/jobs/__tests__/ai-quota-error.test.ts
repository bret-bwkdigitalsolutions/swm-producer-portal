import { describe, it, expect } from "vitest";
import { isAiQuotaError } from "../ai-processor";

describe("isAiQuotaError", () => {
  it("detects the Anthropic monthly usage-limit 400 message", () => {
    const err = new Error(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-09-01 at 00:00 UTC."}}'
    );
    expect(isAiQuotaError(err)).toBe(true);
  });

  it("detects a 429 rate-limit by status", () => {
    expect(isAiQuotaError({ status: 429 })).toBe(true);
  });

  it("detects overloaded / rate-limit / quota wording", () => {
    expect(isAiQuotaError(new Error("Rate limit exceeded"))).toBe(true);
    expect(isAiQuotaError(new Error("the model is Overloaded"))).toBe(true);
    expect(isAiQuotaError("monthly quota reached")).toBe(true);
  });

  it("does not misclassify unrelated errors", () => {
    expect(isAiQuotaError(new Error("Job not found."))).toBe(false);
    expect(isAiQuotaError({ status: 400 })).toBe(false);
    expect(isAiQuotaError(null)).toBe(false);
    expect(isAiQuotaError(undefined)).toBe(false);
  });
});
