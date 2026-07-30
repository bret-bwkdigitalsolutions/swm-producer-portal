import { describe, it, expect } from "vitest";
import {
  resetTokenStatus,
  validateNewPassword,
} from "@/lib/password-reset-token";

describe("resetTokenStatus", () => {
  const now = new Date("2026-07-30T12:00:00Z");

  it("returns 'invalid' for a missing token", () => {
    expect(resetTokenStatus(null, now)).toBe("invalid");
  });

  it("returns 'used' when the token has been consumed", () => {
    expect(
      resetTokenStatus(
        { expiresAt: new Date("2026-07-30T12:30:00Z"), usedAt: new Date("2026-07-30T11:00:00Z") },
        now
      )
    ).toBe("used");
  });

  it("prioritizes 'used' over 'expired'", () => {
    // A consumed token that is also past expiry should still read as 'used'
    // so the user is told to sign in, not to request another link.
    expect(
      resetTokenStatus(
        { expiresAt: new Date("2026-07-30T11:00:00Z"), usedAt: new Date("2026-07-30T10:30:00Z") },
        now
      )
    ).toBe("used");
  });

  it("returns 'expired' when past expiry and unused", () => {
    expect(
      resetTokenStatus(
        { expiresAt: new Date("2026-07-30T11:59:59Z"), usedAt: null },
        now
      )
    ).toBe("expired");
  });

  it("treats the exact expiry instant as expired (boundary)", () => {
    expect(
      resetTokenStatus({ expiresAt: new Date(now), usedAt: null }, now)
    ).toBe("expired");
  });

  it("returns 'valid' when unused and not yet expired", () => {
    expect(
      resetTokenStatus(
        { expiresAt: new Date("2026-07-30T12:00:01Z"), usedAt: null },
        now
      )
    ).toBe("valid");
  });
});

describe("validateNewPassword", () => {
  it("requires both fields", () => {
    expect(validateNewPassword("", "")).toBe("All fields are required.");
    expect(validateNewPassword("longenough", "")).toBe("All fields are required.");
  });

  it("enforces an 8-character minimum", () => {
    expect(validateNewPassword("short", "short")).toBe(
      "Password must be at least 8 characters."
    );
  });

  it("requires the two entries to match", () => {
    expect(validateNewPassword("longenough", "different1")).toBe(
      "Passwords do not match."
    );
  });

  it("accepts a valid, matching password", () => {
    expect(validateNewPassword("longenough", "longenough")).toBeNull();
  });
});
