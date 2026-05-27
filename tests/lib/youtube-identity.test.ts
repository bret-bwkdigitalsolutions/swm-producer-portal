import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockResolveCredential,
  mockFindUnique,
} = vi.hoisted(() => ({
  mockResolveCredential: vi.fn(),
  mockFindUnique: vi.fn(),
}));

vi.mock("@/lib/analytics/credentials", () => ({
  resolveCredential: mockResolveCredential,
}));

vi.mock("@/lib/db", () => ({
  db: {
    youtubeIdentity: {
      findUnique: mockFindUnique,
    },
  },
}));

import { getYoutubeCookiesForShow } from "@/lib/youtube-identity";

describe("getYoutubeCookiesForShow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the show has no resolvable YouTube credential", async () => {
    mockResolveCredential.mockResolvedValue(null);
    const result = await getYoutubeCookiesForShow(42);
    expect(result).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when the credential exists but has no connectedEmail", async () => {
    mockResolveCredential.mockResolvedValue({ connectedEmail: null });
    const result = await getYoutubeCookiesForShow(42);
    expect(result).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns the identity cookies when everything resolves", async () => {
    mockResolveCredential.mockResolvedValue({
      connectedEmail: "owner@example.com",
    });
    mockFindUnique.mockResolvedValue({
      cookies: "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t…\n",
    });
    const result = await getYoutubeCookiesForShow(42);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { email: "owner@example.com" },
      select: { cookies: true },
    });
    expect(result).toContain(".youtube.com");
  });

  it("returns null when the identity row exists but has empty cookies", async () => {
    mockResolveCredential.mockResolvedValue({
      connectedEmail: "owner@example.com",
    });
    mockFindUnique.mockResolvedValue({ cookies: "   " });
    const result = await getYoutubeCookiesForShow(42);
    expect(result).toBeNull();
  });

  it("returns null when the identity row is missing entirely", async () => {
    mockResolveCredential.mockResolvedValue({
      connectedEmail: "owner@example.com",
    });
    mockFindUnique.mockResolvedValue(null);
    const result = await getYoutubeCookiesForShow(42);
    expect(result).toBeNull();
  });
});
