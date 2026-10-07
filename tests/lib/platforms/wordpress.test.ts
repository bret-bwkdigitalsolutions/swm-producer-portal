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
import { WpApiError } from "@/lib/wordpress/types";

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
    meta: { _swm_supersedes: 55 },
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const matchedRecording = {
  airDate: "2026-05-21T03:30:00Z",
  liveRecordingYoutubeId: "liveVid1234",
};

function createdMeta(): Record<string, unknown> {
  const payload = mockCreatePost.mock.calls[0]?.[1] as {
    meta: Record<string, unknown>;
  };
  return payload.meta;
}

describe("publishToWordPress live-stream dedup", () => {
  it("attaches supersede meta when the candidate youtube id matches the recording", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 55,
      title: "Friday Live",
      youtube_id: "liveVid1234",
      date: "2026-05-20",
    });

    const result = await publishToWordPress({
      ...baseParams,
      ...matchedRecording,
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
      supersedeDropped: false,
    });
    expect(console.log).toHaveBeenCalledWith(
      "[wordpress] Replaces live stream post #55"
    );
  });

  it("sends nothing when no live recording was matched", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 55,
      title: "Friday Live",
      youtube_id: "liveVid1234",
      date: "2026-05-20",
    });

    const result = await publishToWordPress({
      ...baseParams,
      airDate: "2026-05-20",
      scheduledDate: "2026-05-20T19:00:00-05:00",
    });

    expect(mockFindLiveStreamCandidate).not.toHaveBeenCalled();
    expect(createdMeta()).not.toHaveProperty("_swm_supersedes");
    expect(createdMeta()).not.toHaveProperty("_swm_live_youtube_id");
    expect(result.supersedesLivePostId).toBeNull();
    expect(result.supersedeDropped).toBe(false);
  });

  it("sends nothing when the candidate youtube id is a different video", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 55,
      title: "Friday Live",
      youtube_id: "someoneElse",
      date: "2026-05-20",
    });

    const result = await publishToWordPress({
      ...baseParams,
      ...matchedRecording,
    });

    expect(createdMeta()).not.toHaveProperty("_swm_supersedes");
    expect(createdMeta()).not.toHaveProperty("_swm_live_youtube_id");
    expect(result.supersedesLivePostId).toBeNull();
  });

  it("sends supersede meta when an entered live id matches and the published video is different", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 4234,
      title: "Rusty Greer live",
      youtube_id: "sLB7STNGACI",
      date: "2026-05-20",
    });

    mockCreatePost.mockResolvedValue({
      id: 900,
      link: "https://example.com/episode/friday",
      meta: { _swm_supersedes: 4234 },
    });

    const result = await publishToWordPress({
      ...baseParams,
      youtubeUrl: "https://www.youtube.com/watch?v=CrP0kNuyT_Y",
      airDate: "2026-10-07",
      liveRecordingYoutubeId: "sLB7STNGACI",
    });

    expect(mockFindLiveStreamCandidate).toHaveBeenCalledWith(22, "2026-10-07");
    expect(createdMeta()).toMatchObject({
      _swm_supersedes: 4234,
      _swm_live_youtube_id: "sLB7STNGACI",
      youtube_video_id: "CrP0kNuyT_Y",
    });
    expect(result.supersedesLivePostId).toBe(4234);
    expect(result.supersedeDropped).toBe(false);
  });

  it("does not send supersede meta when the entered live id does not match the candidate", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 4234,
      title: "Rusty Greer live",
      youtube_id: "sLB7STNGACI",
      date: "2026-05-20",
    });

    const result = await publishToWordPress({
      ...baseParams,
      youtubeUrl: "https://www.youtube.com/watch?v=CrP0kNuyT_Y",
      airDate: "2026-10-07",
      liveRecordingYoutubeId: "otherLive11",
    });

    expect(createdMeta()).not.toHaveProperty("_swm_supersedes");
    expect(createdMeta()).not.toHaveProperty("_swm_live_youtube_id");
    expect(createdMeta().youtube_video_id).toBe("CrP0kNuyT_Y");
    expect(result.supersedesLivePostId).toBeNull();
    expect(result.supersedeDropped).toBe(false);
  });

  it("leaves _swm_live_youtube_id off when the candidate youtube id is missing", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 55,
      title: "Friday Live",
      youtube_id: "",
      date: "2026-05-20",
    });

    const result = await publishToWordPress({
      ...baseParams,
      ...matchedRecording,
    });

    expect(createdMeta()).not.toHaveProperty("_swm_supersedes");
    expect(createdMeta()).not.toHaveProperty("_swm_live_youtube_id");
    expect(result.supersedesLivePostId).toBeNull();
  });

  it("does not send supersede meta for drafts or scheduled posts", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 55,
      title: "Friday Live",
      youtube_id: "liveVid1234",
      date: "2026-05-20",
    });

    for (const status of ["draft", "future"] as const) {
      mockCreatePost.mockClear();
      mockFindLiveStreamCandidate.mockClear();
      const result = await publishToWordPress({
        ...baseParams,
        ...matchedRecording,
        status,
        scheduledDate:
          status === "future" ? "2026-06-01T19:00:00-05:00" : undefined,
      });
      expect(mockFindLiveStreamCandidate).not.toHaveBeenCalled();
      expect(createdMeta()).not.toHaveProperty("_swm_supersedes");
      expect(createdMeta()).not.toHaveProperty("_swm_live_youtube_id");
      expect(result.supersedesLivePostId).toBeNull();
    }
  });

  it("publishes without supersede meta when there is no candidate", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue(null);

    const result = await publishToWordPress({
      ...baseParams,
      ...matchedRecording,
    });

    expect(createdMeta()).not.toHaveProperty("_swm_supersedes");
    expect(createdMeta()).not.toHaveProperty("_swm_live_youtube_id");
    expect(result.supersedesLivePostId).toBeNull();
  });

  it("still publishes when the lookup throws", async () => {
    mockFindLiveStreamCandidate.mockRejectedValue(new Error("socket hang up"));

    const result = await publishToWordPress({
      ...baseParams,
      ...matchedRecording,
    });

    expect(mockCreatePost).toHaveBeenCalledTimes(1);
    expect(createdMeta()).not.toHaveProperty("_swm_supersedes");
    expect(result.supersedesLivePostId).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("socket hang up")
    );
  });

  it("fails the publish when WordPress rejects the create", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 55,
      title: "Friday Live",
      youtube_id: "liveVid1234",
      date: "2026-05-20",
    });
    const failure = new WpApiError(
      'WP API error: 400 — {"code":"rest_invalid_param","message":"Invalid meta _swm_supersedes"}',
      400,
      "/swm_episode"
    );
    mockCreatePost.mockRejectedValueOnce(failure);

    await expect(
      publishToWordPress({ ...baseParams, ...matchedRecording })
    ).rejects.toBe(failure);
    expect(mockCreatePost).toHaveBeenCalledTimes(1);
  });

  it("flags a 201 that omitted _swm_supersedes and does not claim a replacement", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 55,
      title: "Friday Live",
      youtube_id: "liveVid1234",
      date: "2026-05-20",
    });
    mockCreatePost.mockResolvedValue({
      id: 900,
      link: "https://example.com/episode/friday",
      meta: { youtube_video_id: "abc123xyz09" },
    });

    const result = await publishToWordPress({
      ...baseParams,
      ...matchedRecording,
    });

    expect(mockCreatePost).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      postId: 900,
      postUrl: "https://example.com/episode/friday",
      supersedesLivePostId: null,
      supersedeDropped: true,
    });
    expect(console.warn).toHaveBeenCalledWith(
      "[wordpress] Create response omitted _swm_supersedes for live post #55; not retrying."
    );
  });

  it("treats a string echo of _swm_supersedes as kept", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 55,
      title: "Friday Live",
      youtube_id: "liveVid1234",
      date: "2026-05-20",
    });
    mockCreatePost.mockResolvedValue({
      id: 900,
      link: "https://example.com/episode/friday",
      meta: { _swm_supersedes: "55" },
    });

    const result = await publishToWordPress({
      ...baseParams,
      ...matchedRecording,
    });

    expect(result.supersedeDropped).toBe(false);
    expect(result.supersedesLivePostId).toBe(55);
    expect(mockCreatePost).toHaveBeenCalledTimes(1);
  });
});
