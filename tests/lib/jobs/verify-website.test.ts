import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/analytics/credentials", () => ({
  getYouTubeAccessToken: vi.fn(),
  getTransistorApiKey: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { websiteVerificationIssues } from "@/lib/jobs/verify-distribution";

const ctx = {
  jobId: "job-1",
  wpShowId: 21,
  expectedTitle: "Episode 1",
  isLiveRecording: false,
  isPremium: false,
};

afterEach(() => {
  mockFetch.mockReset();
  delete process.env.VIDEO_WORKER;
  delete process.env.NEXTAUTH_URL;
  delete process.env.JOB_PROCESSING_SECRET;
});

describe("website verification", () => {
  it("reads the episode from WordPress when the portal itself is verifying", async () => {
    process.env.WP_API_URL = "https://example.com/wp-json/wp/v2";
    process.env.WP_APP_USER = "user";
    process.env.WP_APP_PASSWORD = "pass";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 55,
        title: { rendered: "Episode 1" },
        featured_media: 9,
        status: "publish",
        link: "https://example.com/ep",
      }),
    });

    await expect(websiteVerificationIssues(1, "55", ctx)).resolves.toEqual([]);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://example.com/wp-json/wp/v2/swm_episode/55?_fields=id,title,featured_media,status,link"
    );
  });

  it("asks the portal to verify when running as the video worker", async () => {
    process.env.VIDEO_WORKER = "1";
    process.env.NEXTAUTH_URL = "https://portal.example.com";
    process.env.JOB_PROCESSING_SECRET = "job-secret";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          ok: true,
          result: [
            {
              platform: "website",
              field: "title",
              expected: "Episode 1",
              actual: "Other",
            },
          ],
        }),
    });

    const issues = await websiteVerificationIssues(2, "55", ctx);

    expect(issues).toEqual([
      { platform: "website", field: "title", expected: "Episode 1", actual: "Other" },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://portal.example.com/api/jobs/wordpress");
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer job-secret");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
      op: "verifyEpisode",
      tier: 2,
      postId: "55",
      wpShowId: 21,
      expectedTitle: "Episode 1",
    });
  });
});
