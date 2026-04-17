import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate, mockCreateMany, mockActivityCreate, mockFindUnique } =
  vi.hoisted(() => ({
    mockCreate: vi.fn().mockResolvedValue({ id: "job-1" }),
    mockCreateMany: vi.fn().mockResolvedValue({}),
    mockActivityCreate: vi.fn().mockResolvedValue({}),
    mockFindUnique: vi.fn(),
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

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: any) =>
      fn({
        distributionJob: { create: mockCreate },
        distributionJobPlatform: { createMany: mockCreateMany },
        activityLog: { create: mockActivityCreate },
      })
    ),
    userShowAccess: { findUnique: mockFindUnique },
  },
}));

import { submitDistribution } from "@/app/dashboard/distribute/new/actions";

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
      existing_youtube_url: "https://www.youtube.com/watch?v=abc123",
    });
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(true);
    const createdData = mockCreate.mock.calls[0][0].data;
    expect(createdData.metadata.existingYoutubeUrl).toBe(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(createdData.metadata.videoFileName).toBeNull();
  });

  it("accepts a YouTube /live/ URL", async () => {
    const fd = makeFormData({
      ...BASE_FIELDS,
      existing_youtube_url: "https://www.youtube.com/live/abc123",
    });
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(true);
    const createdData = mockCreate.mock.calls[0][0].data;
    expect(createdData.metadata.existingYoutubeUrl).toBe(
      "https://www.youtube.com/live/abc123"
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
});
