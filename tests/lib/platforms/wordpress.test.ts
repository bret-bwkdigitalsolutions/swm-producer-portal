import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mockCreatePost = vi.fn();
const mockFindLiveStreamCandidate = vi.fn();

vi.mock("@/lib/wordpress/client", () => ({
  createPost: (...args: unknown[]) => mockCreatePost(...args),
  uploadMedia: vi.fn(),
}));

vi.mock("@/lib/image", () => ({
  prepareForWordPress: vi.fn(),
}));

vi.mock("@/lib/wordpress/live-candidate", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/wordpress/live-candidate")
  >("@/lib/wordpress/live-candidate");
  return {
    ...actual,
    findLiveStreamCandidate: (...args: unknown[]) =>
      mockFindLiveStreamCandidate(...args),
  };
});

import { publishToWordPress } from "@/lib/platforms/wordpress";
import { ContentType } from "@/lib/constants";

const baseParams = {
  wpShowId: 22,
  title: "Friday Night Live",
  description: "The archived cut.",
  youtubeUrl: "https://www.youtube.com/watch?v=abc123xyz09",
  status: "publish" as const,
  portalUserId: "user-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreatePost.mockResolvedValue({
    id: 900,
    link: "https://example.com/episode/friday",
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function createdMeta(): Record<string, unknown> {
  const payload = mockCreatePost.mock.calls[0]?.[1] as {
    meta: Record<string, unknown>;
  };
  return payload.meta;
}

describe("publishToWordPress live-stream dedup", () => {
  it("attaches supersede meta when a live candidate exists", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 55,
      title: "Friday Live",
      youtube_id: "liveVid1234",
      date: "2026-05-20",
    });

    const result = await publishToWordPress({
      ...baseParams,
      airDate: "2026-05-21T03:30:00Z",
    });

    expect(mockFindLiveStreamCandidate).toHaveBeenCalledWith(22, "2026-05-20");
    expect(mockCreatePost).toHaveBeenCalledWith(
      ContentType.EPISODE,
      expect.objectContaining({
        title: "Friday Night Live",
        status: "publish",
      })
    );
    expect(createdMeta()).toMatchObject({
      _swm_supersedes: 55,
      _swm_live_youtube_id: "liveVid1234",
      parent_show_id: 22,
      youtube_video_id: "abc123xyz09",
    });
    expect(result).toEqual({
      postId: 900,
      postUrl: "https://example.com/episode/friday",
      supersedesLivePostId: 55,
    });
    expect(console.log).toHaveBeenCalledWith(
      "[wordpress] Replaces live stream post #55"
    );
  });

  it("publishes without supersede meta when there is no candidate", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue(null);

    const result = await publishToWordPress(baseParams);

    expect(createdMeta()).not.toHaveProperty("_swm_supersedes");
    expect(createdMeta()).not.toHaveProperty("_swm_live_youtube_id");
    expect(result.supersedesLivePostId).toBeNull();
  });

  it("still publishes when the lookup throws", async () => {
    mockFindLiveStreamCandidate.mockRejectedValue(new Error("socket hang up"));

    const result = await publishToWordPress(baseParams);

    expect(mockCreatePost).toHaveBeenCalledTimes(1);
    expect(createdMeta()).not.toHaveProperty("_swm_supersedes");
    expect(result.supersedesLivePostId).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("socket hang up")
    );
  });

  it("uses the scheduled publish date when no air date is given", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue(null);

    await publishToWordPress({
      ...baseParams,
      status: "future",
      scheduledDate: "2026-06-01T19:00:00-05:00",
    });

    expect(mockFindLiveStreamCandidate).toHaveBeenCalledWith(22, "2026-06-01");
  });
});
