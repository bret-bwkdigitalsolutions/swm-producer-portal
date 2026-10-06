import { describe, it, expect } from "vitest";
import { createOAuthState, parseOAuthStateShowId, verifyOAuthState } from "@/lib/oauth-state";

describe("YouTube OAuth state", () => {
  it("encodes the show id plus a random nonce", () => {
    const a = createOAuthState(42);
    const b = createOAuthState(42);
    expect(a).toMatch(/^42\.[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
    expect(parseOAuthStateShowId(a)).toBe(42);
  });

  it("verifies only when the state matches the cookie", () => {
    const state = createOAuthState(7);
    expect(verifyOAuthState(state, state)).toBe(true);
    expect(verifyOAuthState(state, createOAuthState(7))).toBe(false);
    expect(verifyOAuthState(state, undefined)).toBe(false);
  });

  it("rejects the old bare show-id state (CSRF)", () => {
    expect(parseOAuthStateShowId("7")).toBeNull();
    expect(verifyOAuthState("7", "7")).toBe(false);
  });
});
