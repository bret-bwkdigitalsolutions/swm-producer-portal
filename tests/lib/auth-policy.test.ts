import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: (...a: unknown[]) => mockFindUnique(...a) } },
}));

import { isGoogleSignInAllowed } from "@/lib/auth-policy";

beforeEach(() => vi.clearAllMocks());

describe("isGoogleSignInAllowed (invite-only Google sign-in)", () => {
  it("allows an existing (invited/admin-created) user", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1" });
    expect(await isGoogleSignInAllowed("rob@stolenwatermedia.com", true)).toBe(true);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { email: "rob@stolenwatermedia.com" },
      select: { id: true },
    });
  });

  it("refuses an email with no portal account (no self-sign-up)", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await isGoogleSignInAllowed("stranger@gmail.com", true)).toBe(false);
  });

  it("refuses unverified Google emails without touching the database", async () => {
    expect(await isGoogleSignInAllowed("rob@stolenwatermedia.com", false)).toBe(false);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("refuses when Google returned no email", async () => {
    expect(await isGoogleSignInAllowed(undefined, true)).toBe(false);
  });
});
