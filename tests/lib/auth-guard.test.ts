import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    // redirect() in Next.js throws to halt execution; simulate that
    throw new Error("NEXT_REDIRECT");
  },
}));

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockUserContentTypeAccessFindUnique = vi.fn();
const mockUserShowAccessFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    userContentTypeAccess: {
      findUnique: (...args: unknown[]) =>
        mockUserContentTypeAccessFindUnique(...args),
    },
    userShowAccess: {
      findUnique: (...args: unknown[]) =>
        mockUserShowAccessFindUnique(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock auth
// ---------------------------------------------------------------------------

const mockAuth = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import {
  requireAuth,
  requireAdmin,
  requireContentTypeAccess,
  verifyShowAccess,
  verifyContentTypeAccess,
} from "@/lib/auth-guard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: "user-1",
      role: "producer",
      email: "producer@example.com",
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("auth-guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // requireAuth
  // -----------------------------------------------------------------------

  describe("requireAuth", () => {
    it("returns the session when the user is authenticated", async () => {
      const session = makeSession();
      mockAuth.mockResolvedValue(session);

      const result = await requireAuth();
      expect(result).toEqual(session);
    });

    it("redirects to /login when there is no session", async () => {
      mockAuth.mockResolvedValue(null);

      await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT");
      expect(mockRedirect).toHaveBeenCalledWith("/login");
    });

    it("redirects to /login when session.user is undefined", async () => {
      mockAuth.mockResolvedValue({ user: undefined });

      await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT");
      expect(mockRedirect).toHaveBeenCalledWith("/login");
    });
  });

  // -----------------------------------------------------------------------
  // requireAdmin
  // -----------------------------------------------------------------------

  describe("requireAdmin", () => {
    it("returns the session for an admin user", async () => {
      const session = makeSession({ role: "admin" });
      mockAuth.mockResolvedValue(session);

      const result = await requireAdmin();
      expect(result).toEqual(session);
    });

    it("redirects to /dashboard for a non-admin user", async () => {
      const session = makeSession({ role: "producer" });
      mockAuth.mockResolvedValue(session);

      await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
      expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    });

    it("redirects to /login when there is no session (via requireAuth)", async () => {
      mockAuth.mockResolvedValue(null);

      await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
      expect(mockRedirect).toHaveBeenCalledWith("/login");
    });
  });

  // -----------------------------------------------------------------------
  // requireContentTypeAccess
  // -----------------------------------------------------------------------

  describe("requireContentTypeAccess", () => {
    it("allows admin users without checking the database", async () => {
      const session = makeSession({ role: "admin" });
      mockAuth.mockResolvedValue(session);

      const result = await requireContentTypeAccess("review");
      expect(result).toEqual(session);
      expect(mockUserContentTypeAccessFindUnique).not.toHaveBeenCalled();
    });

    it("allows producers who have content type access", async () => {
      const session = makeSession({ role: "producer" });
      mockAuth.mockResolvedValue(session);
      mockUserContentTypeAccessFindUnique.mockResolvedValue({
        id: "access-1",
        userId: "user-1",
        contentType: "review",
      });

      const result = await requireContentTypeAccess("review");
      expect(result).toEqual(session);
      expect(mockUserContentTypeAccessFindUnique).toHaveBeenCalledWith({
        where: {
          userId_contentType: {
            userId: "user-1",
            contentType: "review",
          },
        },
      });
    });

    it("redirects to /dashboard when a producer lacks content type access", async () => {
      const session = makeSession({ role: "producer" });
      mockAuth.mockResolvedValue(session);
      mockUserContentTypeAccessFindUnique.mockResolvedValue(null);

      await expect(requireContentTypeAccess("episode")).rejects.toThrow(
        "NEXT_REDIRECT"
      );
      expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    });
  });

  // -----------------------------------------------------------------------
  // verifyShowAccess
  // -----------------------------------------------------------------------

  describe("verifyShowAccess", () => {
    it("returns true when the user has show access", async () => {
      mockUserShowAccessFindUnique.mockResolvedValue({
        id: "sa-1",
        userId: "user-1",
        wpShowId: 42,
      });

      const result = await verifyShowAccess("user-1", 42);
      expect(result).toBe(true);
      expect(mockUserShowAccessFindUnique).toHaveBeenCalledWith({
        where: { userId_wpShowId: { userId: "user-1", wpShowId: 42 } },
      });
    });

    it("returns false when the user does not have show access", async () => {
      mockUserShowAccessFindUnique.mockResolvedValue(null);

      const result = await verifyShowAccess("user-1", 99);
      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // verifyContentTypeAccess
  // -----------------------------------------------------------------------

  describe("verifyContentTypeAccess", () => {
    it("returns true for admin users without a database check", async () => {
      const result = await verifyContentTypeAccess("user-1", "admin", "review");
      expect(result).toBe(true);
      expect(mockUserContentTypeAccessFindUnique).not.toHaveBeenCalled();
    });

    it("returns true for producers with access", async () => {
      mockUserContentTypeAccessFindUnique.mockResolvedValue({
        id: "ct-1",
        userId: "user-1",
        contentType: "trailer",
      });

      const result = await verifyContentTypeAccess(
        "user-1",
        "producer",
        "trailer"
      );
      expect(result).toBe(true);
    });

    it("returns false for producers without access", async () => {
      mockUserContentTypeAccessFindUnique.mockResolvedValue(null);

      const result = await verifyContentTypeAccess(
        "user-1",
        "producer",
        "episode"
      );
      expect(result).toBe(false);
    });
  });
});
