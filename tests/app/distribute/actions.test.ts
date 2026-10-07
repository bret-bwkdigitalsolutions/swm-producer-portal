import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCreate,
  mockCreateMany,
  mockActivityCreate,
  mockFindUnique,
  mockJobFindUnique,
  mockJobUpdate,
  mockPlatformDeleteMany,
  mockLookupLiveStreamCandidate,
} = vi.hoisted(() => ({
  mockCreate: vi.fn().mockResolvedValue({ id: "job-1" }),
  mockCreateMany: vi.fn().mockResolvedValue({}),
  mockActivityCreate: vi.fn().mockResolvedValue({}),
  mockFindUnique: vi.fn(),
  mockJobFindUnique: vi.fn(),
  mockJobUpdate: vi.fn().mockResolvedValue({}),
  mockPlatformDeleteMany: vi.fn().mockResolvedValue({}),
  mockLookupLiveStreamCandidate: vi.fn(),
}));

// Mock auth and db
vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: {
      id: "user-1",
      role: "admin",
      hasDistributionAccess: true,
    },
  }),
}));

vi.mock("@/lib/wordpress/live-candidate", () => ({
  lookupLiveStreamCandidate: (...args: unknown[]) =>
    mockLookupLiveStreamCandidate(...args),
  toAirDate: () => "2026-10-07",
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: any) =>
      fn({
        distributionJob: { create: mockCreate, update: mockJobUpdate },
        distributionJobPlatform: {
          createMany: mockCreateMany,
          deleteMany: mockPlatformDeleteMany,
        },
        activityLog: { create: mockActivityCreate },
      })
    ),
    userShowAccess: { findUnique: mockFindUnique },
    distributionJob: { findUnique: mockJobFindUnique },
  },
}));

import {
  previewLiveStreamReplacement,
  submitDistribution,
  updateDistribution,
} from "@/app/dashboard/distribute/new/actions";

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) {
    fd.set(key, val);
  }
  return fd;
}

const BASE_FIELDS = {
  show_id: "42",
  title: "Test Episode",
  description: "Episode description",
  platform_youtube: "on",
};

describe("submitDistribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ id: "job-1" });
  });

  it("accepts a video file upload (existing behavior)", async () => {
    const fd = makeFormData({
      ...BASE_FIELDS,
      video_file_name: "episode.mp4",
      video_file_size: "1000000",
      video_content_type: "video/mp4",
    });
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(true);
    expect(result.jobId).toBe("job-1");
    const createdData = mockCreate.mock.calls[0][0].data;
    expect(createdData.metadata.videoFileName).toBe("episode.mp4");
    expect(createdData.metadata.existingYoutubeUrl).toBeUndefined();
  });

  it("accepts an existing YouTube URL instead of a file", async () => {
    const fd = makeFormData({
      ...BASE_FIELDS,
      existing_youtube_url: "https://www.youtube.com/watch?v=abc12345678",
    });
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(true);
    const createdData = mockCreate.mock.calls[0][0].data;
    expect(createdData.metadata.existingYoutubeUrl).toBe(
      "https://www.youtube.com/watch?v=abc12345678"
    );
    expect(createdData.metadata.videoFileName).toBeNull();
  });

  it("accepts a YouTube /live/ URL", async () => {
    const fd = makeFormData({
      ...BASE_FIELDS,
      existing_youtube_url: "https://www.youtube.com/live/abc12345678",
    });
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(true);
    const createdData = mockCreate.mock.calls[0][0].data;
    expect(createdData.metadata.existingYoutubeUrl).toBe(
      "https://www.youtube.com/live/abc12345678"
    );
  });

  it("fails validation when neither video file nor YouTube URL is provided", async () => {
    const fd = makeFormData(BASE_FIELDS);
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(false);
    expect(result.errors?.video_file).toBeDefined();
  });

  it("fails validation for a non-YouTube URL", async () => {
    const fd = makeFormData({
      ...BASE_FIELDS,
      existing_youtube_url: "https://vimeo.com/123456",
    });
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(false);
    expect(result.errors?.video_file).toBeDefined();
  });

  it("fails validation for a YouTube URL without a video ID", async () => {
    const fd = makeFormData({
      ...BASE_FIELDS,
      existing_youtube_url: "https://www.youtube.com/playlist?list=abc",
    });
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(false);
    expect(result.errors?.video_file).toBeDefined();
  });

  it("stores a parsed live stream video id and allows a blank URL", async () => {
    const withLive = makeFormData({
      ...BASE_FIELDS,
      video_file_name: "episode.mp4",
      live_stream_url: "https://www.youtube.com/live/sLB7STNGACI",
    });
    const saved = await submitDistribution({}, withLive);
    expect(saved.success).toBe(true);
    expect(mockCreate.mock.calls[0][0].data.metadata.liveYoutubeVideoId).toBe(
      "sLB7STNGACI"
    );
    expect(mockCreate.mock.calls[0][0].data.metadata.liveStreamUrl).toBe(
      "https://www.youtube.com/live/sLB7STNGACI"
    );

    mockCreate.mockClear();
    const blank = makeFormData({
      ...BASE_FIELDS,
      video_file_name: "episode.mp4",
      live_stream_url: "   ",
    });
    const empty = await submitDistribution({}, blank);
    expect(empty.success).toBe(true);
    expect(mockCreate.mock.calls[0][0].data.metadata.liveYoutubeVideoId).toBeUndefined();
  });

  it("returns a form error for an invalid live stream URL", async () => {
    const fd = makeFormData({
      ...BASE_FIELDS,
      video_file_name: "episode.mp4",
      live_stream_url: "https://vimeo.com/123456789",
    });
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(false);
    expect(result.errors?.live_stream_url?.[0]).toMatch(/YouTube URL/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("accepts a placeholder title for AI path (description not required)", async () => {
    const fd = makeFormData({
      show_id: "42",
      title: "AI analysis in progress",
      description: "AI-generated description pending",
      platform_youtube: "on",
      video_file_name: "episode.mp4",
      video_file_size: "1000000",
      video_content_type: "video/mp4",
    });
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(true);
  });
});

describe("previewLiveStreamReplacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the live post title and date for a youtube_id match", async () => {
    mockLookupLiveStreamCandidate.mockResolvedValue({
      ok: true,
      candidate: {
        id: 4234,
        title: "Rusty Greer",
        youtube_id: "sLB7STNGACI",
        date: "2026-05-20",
      },
    });

    const result = await previewLiveStreamReplacement(
      22,
      "https://www.youtube.com/live/sLB7STNGACI"
    );

    expect(result).toEqual({
      status: "match",
      title: "Rusty Greer",
      date: "2026-05-20",
    });
    expect(mockLookupLiveStreamCandidate).toHaveBeenCalledWith(
      22,
      "2026-10-07",
      "sLB7STNGACI"
    );
  });

  it("reports no match without throwing", async () => {
    mockLookupLiveStreamCandidate.mockResolvedValue({
      ok: true,
      candidate: null,
    });

    await expect(
      previewLiveStreamReplacement(22, "https://youtu.be/sLB7STNGACI")
    ).resolves.toEqual({ status: "none" });
  });

  it("returns an error status when the lookup fails", async () => {
    mockLookupLiveStreamCandidate.mockResolvedValue({ ok: false });

    await expect(
      previewLiveStreamReplacement(22, "https://youtu.be/sLB7STNGACI")
    ).resolves.toEqual({ status: "error" });
  });
});

describe("updateDistribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJobFindUnique.mockResolvedValue({
      id: "job-1",
      userId: "user-1",
      metadata: { description: "old desc", thumbnailGcsPath: "thumb.jpg" },
    });
    mockJobUpdate.mockResolvedValue({});
    mockPlatformDeleteMany.mockResolvedValue({});
    mockCreateMany.mockResolvedValue({});
  });

  it("updates title on the job record", async () => {
    const result = await updateDistribution("job-1", {
      title: "Updated Title",
      description: "Some description",
      platforms: ["youtube"],
    });
    expect(result.success).toBe(true);
    const updateCall = mockJobUpdate.mock.calls[0][0];
    expect(updateCall.data.title).toBe("Updated Title");
  });

  it("updates seasonNumber and episodeNumber in metadata", async () => {
    const result = await updateDistribution("job-1", {
      description: "Some description",
      platforms: ["youtube"],
      seasonNumber: 3,
      episodeNumber: 42,
    });
    expect(result.success).toBe(true);
    const updateCall = mockJobUpdate.mock.calls[0][0];
    expect(updateCall.data.metadata.seasonNumber).toBe(3);
    expect(updateCall.data.metadata.episodeNumber).toBe(42);
  });

  it("updates explicit flag in metadata", async () => {
    const result = await updateDistribution("job-1", {
      description: "Some description",
      platforms: ["youtube"],
      explicit: true,
    });
    expect(result.success).toBe(true);
    const updateCall = mockJobUpdate.mock.calls[0][0];
    expect(updateCall.data.metadata.explicit).toBe(true);
  });

  it("replaces a stored live video id from the review form", async () => {
    mockJobFindUnique.mockResolvedValue({
      id: "job-1",
      userId: "user-1",
      metadata: { description: "old desc", liveYoutubeVideoId: "oldVideo111" },
    });
    const result = await updateDistribution("job-1", {
      description: "Some description",
      platforms: ["youtube"],
      liveStreamUrl: "https://youtu.be/sLB7STNGACI",
    });
    expect(result.success).toBe(true);
    expect(mockJobUpdate.mock.calls[0][0].data.metadata.liveYoutubeVideoId).toBe(
      "sLB7STNGACI"
    );
    expect(mockJobUpdate.mock.calls[0][0].data.metadata.liveStreamUrl).toBe(
      "https://youtu.be/sLB7STNGACI"
    );
  });

  it("preserves existing metadata fields not being updated", async () => {
    const result = await updateDistribution("job-1", {
      description: "New description",
      platforms: ["youtube"],
    });
    expect(result.success).toBe(true);
    const updateCall = mockJobUpdate.mock.calls[0][0];
    expect(updateCall.data.metadata.thumbnailGcsPath).toBe("thumb.jpg");
  });
});
