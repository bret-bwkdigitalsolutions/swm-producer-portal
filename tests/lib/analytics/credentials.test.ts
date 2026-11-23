import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getVimeoAccessToken,
  resolveCredential,
  resolvePlatformId,
} from "@/lib/analytics/credentials";

// Mock the db module
vi.mock("@/lib/db", () => ({
  db: {
    platformCredential: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    showPlatformLink: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock youtube-oauth
vi.mock("@/lib/youtube-oauth", () => ({
  refreshAccessToken: vi.fn(),
}));

import { db } from "@/lib/db";

const mockCredentialFind = vi.mocked(db.platformCredential.findUnique);
const mockPlatformLinkFind = vi.mocked(db.showPlatformLink.findUnique);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveCredential", () => {
  it("returns show-specific credential when it exists", async () => {
    const cred = { id: "1", apiKey: "key123", platform: "transistor" };
    mockCredentialFind.mockResolvedValue(cred as never);

    const result = await resolveCredential(5, "transistor");

    expect(result).toEqual(cred);
    expect(mockCredentialFind).toHaveBeenCalledWith({
      where: { wpShowId_platform: { wpShowId: 5, platform: "transistor" } },
    });
  });

  it("falls back to network default (wpShowId=0) when show-specific not found", async () => {
    const networkCred = { id: "2", apiKey: "network-key", platform: "transistor" };
    mockCredentialFind
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(networkCred as never);

    const result = await resolveCredential(5, "transistor");

    expect(result).toEqual(networkCred);
    expect(mockCredentialFind).toHaveBeenCalledTimes(2);
  });

  it("returns null when no credential exists at any level", async () => {
    mockCredentialFind.mockResolvedValue(null as never);

    const result = await resolveCredential(5, "transistor");

    expect(result).toBeNull();
  });
});

describe("resolvePlatformId", () => {
  it("returns show-specific platform link URL", async () => {
    mockPlatformLinkFind.mockResolvedValue({
      id: "1",
      url: "https://share.transistor.fm/s/abc123",
      wpShowId: 5,
      platform: "transistor_show",
    } as never);

    const result = await resolvePlatformId(5, "transistor_show");

    expect(result).toBe("https://share.transistor.fm/s/abc123");
  });

  it("falls back to network default when show-specific not found", async () => {
    mockPlatformLinkFind
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        id: "2",
        url: "https://share.transistor.fm/s/network",
        wpShowId: 0,
        platform: "transistor_show",
      } as never);

    const result = await resolvePlatformId(5, "transistor_show");

    expect(result).toBe("https://share.transistor.fm/s/network");
  });

  it("reads the Vimeo token stored on Your Dark Companion and does not use the network default", async () => {
    mockCredentialFind.mockResolvedValueOnce(null as never);
    await expect(getVimeoAccessToken(21)).resolves.toBeNull();
    expect(mockCredentialFind).toHaveBeenCalledTimes(1);
    expect(mockCredentialFind).toHaveBeenCalledWith({
      where: { wpShowId_platform: { wpShowId: 21, platform: "vimeo" } },
    });

    mockCredentialFind.mockResolvedValueOnce({
      id: "v",
      apiKey: "vimeo-token-value",
      accessToken: null,
      platform: "vimeo",
    } as never);
    await expect(getVimeoAccessToken(21)).resolves.toBe("vimeo-token-value");
  });

  it("returns null when no platform link exists", async () => {
    mockPlatformLinkFind.mockResolvedValue(null as never);

    const result = await resolvePlatformId(5, "transistor_show");

    expect(result).toBeNull();
  });
});
