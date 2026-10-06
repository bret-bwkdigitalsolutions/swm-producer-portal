import { describe, it, expect } from "vitest";
import { bearerTokenMatches } from "@/lib/secure-compare";

describe("bearerTokenMatches", () => {
  it("matches only the exact bearer token", () => {
    expect(bearerTokenMatches("Bearer s3cret-value", "s3cret-value")).toBe(true);
    expect(bearerTokenMatches("Bearer s3cret-valuX", "s3cret-value")).toBe(false);
    expect(bearerTokenMatches("Bearer s3cret", "s3cret-value")).toBe(false);
    expect(bearerTokenMatches("s3cret-value", "s3cret-value")).toBe(false);
    expect(bearerTokenMatches(null, "s3cret-value")).toBe(false);
    expect(bearerTokenMatches("Bearer ", "")).toBe(false);
  });
});
