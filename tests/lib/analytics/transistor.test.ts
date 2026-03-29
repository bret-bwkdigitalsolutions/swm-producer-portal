import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/analytics/credentials", () => ({
  getTransistorApiKey: vi.fn(),
  resolvePlatformId: vi.fn(),
  parseTransistorShowId: vi.fn((id: string) => id),
}));

vi.mock("@/lib/analytics/cache", () => ({
  getCached: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { getTransistorShowAnalytics } from "@/lib/analytics/transistor";
import { getTransistorApiKey, resolvePlatformId } from "@/lib/analytics/credentials";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTransistorShowAnalytics", () => {
  it("fetches show analytics with correct params", async () => {
    vi.mocked(getTransistorApiKey).mockResolvedValue("test-key");
    vi.mocked(resolvePlatformId).mockResolvedValue("12345");

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            attributes: {
              downloads: [
                { date: "2026-03-01", downloads: 100 },
                { date: "2026-03-02", downloads: 150 },
              ],
            },
          },
        }),
    });

    const result = await getTransistorShowAnalytics(5, {
      from: "2026-03-01",
      to: "2026-03-02",
    });

    expect(result).toEqual([
      { date: "2026-03-01", downloads: 100 },
      { date: "2026-03-02", downloads: 150 },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("show_id=12345"),
      expect.objectContaining({
        headers: { "x-api-key": "test-key" },
      })
    );
  });

  it("throws when no API key is configured", async () => {
    vi.mocked(getTransistorApiKey).mockResolvedValue(null);

    await expect(
      getTransistorShowAnalytics(5, { from: "2026-03-01", to: "2026-03-02" })
    ).rejects.toThrow("No Transistor API key");
  });
});
