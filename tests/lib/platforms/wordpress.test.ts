import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mockCreatePost = vi.fn();
const mockFindLiveStreamCandidate = vi.fn();
const mockFindEpisodeCreatedForShow = vi.fn();

vi.mock("@/lib/wordpress/client", () => ({
  createPost: (...args: unknown[]) => mockCreatePost(...args),
  uploadMedia: vi.fn(),
  findEpisodeCreatedForShow: (...args: unknown[]) =>
    mockFindEpisodeCreatedForShow(...args),
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

function metaError(status: 400 | 403, key: string): WpApiError {
  return new WpApiError(
    `WP API error: ${status} — {"code":"rest_invalid_param","message":"Invalid meta ${key}"}`,
    status,
    "/swm_episode"
  );
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

  it("adopts the created post when WordPress rejects supersede meta with 400 or 403", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 55,
      title: "Friday Live",
      youtube_id: "liveVid1234",
      date: "2026-05-20",
    });
    mockFindEpisodeCreatedForShow.mockResolvedValue({
      id: 901,
      link: "https://example.com/episode/friday-night-live",
    });

    for (const failure of [
      metaError(400, "_swm_supersedes"),
      metaError(403, "_swm_live_youtube_id"),
    ]) {
      mockCreatePost.mockRejectedValueOnce(failure);
      const result = await publishToWordPress({
        ...baseParams,
        ...matchedRecording,
      });
      expect(result).toEqual({
        postId: 901,
        postUrl: "https://example.com/episode/friday-night-live",
        supersedesLivePostId: 55,
      });
    }

    expect(mockFindEpisodeCreatedForShow).toHaveBeenCalledWith(
      22,
      "Friday Night Live",
      { excludeIds: [55] }
    );
    expect(mockCreatePost).toHaveBeenCalledTimes(2);
  });

  it("still fails when supersede meta is rejected and the new post cannot be found", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 55,
      title: "Friday Live",
      youtube_id: "liveVid1234",
      date: "2026-05-20",
    });
    const failure = metaError(400, "_swm_supersedes");
    mockCreatePost.mockRejectedValueOnce(failure);
    mockFindEpisodeCreatedForShow.mockResolvedValue(null);

    await expect(
      publishToWordPress({ ...baseParams, ...matchedRecording })
    ).rejects.toBe(failure);
  });

  it("does not look up an existing post for unrelated create errors", async () => {
    mockFindLiveStreamCandidate.mockResolvedValue({
      id: 55,
      title: "Friday Live",
      youtube_id: "liveVid1234",
      date: "2026-05-20",
    });
    mockCreatePost.mockRejectedValueOnce(
      new WpApiError("WP API error: 400 — {\"message\":\"title is empty\"}", 400, "/swm_episode")
    );

    await expect(
      publishToWordPress({ ...baseParams, ...matchedRecording })
    ).rejects.toBeInstanceOf(WpApiError);
    expect(mockFindEpisodeCreatedForShow).not.toHaveBeenCalled();

    mockCreatePost.mockRejectedValueOnce(
      new WpApiError("WP API error: 500 — {_swm_supersedes}", 500, "/swm_episode")
    );
    await expect(
      publishToWordPress({ ...baseParams, ...matchedRecording })
    ).rejects.toBeInstanceOf(WpApiError);
    expect(mockFindEpisodeCreatedForShow).not.toHaveBeenCalled();
  });
});
