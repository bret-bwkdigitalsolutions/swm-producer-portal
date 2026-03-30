import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockFindUnique = vi.fn();
const mockJobUpdate = vi.fn();
const mockPlatformUpdate = vi.fn();
const mockUserFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    distributionJob: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockJobUpdate(...args),
    },
    distributionJobPlatform: {
      update: (...args: unknown[]) => mockPlatformUpdate(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock platform modules
// ---------------------------------------------------------------------------

const mockUploadToYouTube = vi.fn();
const mockAddToPlaylist = vi.fn();
const mockUploadToTransistor = vi.fn();
const mockPublishToWordPress = vi.fn();
const mockSendDistributionErrorNotification = vi.fn();
const mockResolvePlatformId = vi.fn();
const mockExtractAudio = vi.fn();
const mockGenerateSignedDownloadUrl = vi.fn();

vi.mock("@/lib/platforms/youtube", () => ({
  uploadToYouTube: (...args: unknown[]) => mockUploadToYouTube(...args),
  addToPlaylist: (...args: unknown[]) => mockAddToPlaylist(...args),
}));

vi.mock("@/lib/platforms/transistor", () => ({
  uploadToTransistor: (...args: unknown[]) => mockUploadToTransistor(...args),
}));

vi.mock("@/lib/platforms/wordpress", () => ({
  publishToWordPress: (...args: unknown[]) => mockPublishToWordPress(...args),
}));

vi.mock("@/lib/notifications", () => ({
  sendDistributionErrorNotification: (...args: unknown[]) =>
    mockSendDistributionErrorNotification(...args),
}));

vi.mock("@/lib/analytics/credentials", () => ({
  resolvePlatformId: (...args: unknown[]) => mockResolvePlatformId(...args),
}));

vi.mock("@/lib/jobs/audio-extractor", () => ({
  extractAudio: (...args: unknown[]) => mockExtractAudio(...args),
}));

vi.mock("@/lib/gcs", () => ({
  generateSignedDownloadUrl: (...args: unknown[]) =>
    mockGenerateSignedDownloadUrl(...args),
}));

// Mock AI processor (unused in new processor but imported)
vi.mock("@/lib/jobs/ai-processor", () => ({
  generateAiSuggestions: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { processJob } from "@/lib/jobs/processor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    title: "Episode 1",
    status: "pending",
    userId: "user-1",
    wpShowId: 42,
    gcsPath: "uploads/2026/03/video.mp4",
    metadata: { description: "A test episode" },
    platforms: [{ id: "plat-yt", platform: "youtube" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPlatformUpdate.mockResolvedValue({});
    mockJobUpdate.mockResolvedValue({});
    mockUserFindUnique.mockResolvedValue({ name: "Test User" });
    mockResolvePlatformId.mockResolvedValue(null);
    mockExtractAudio.mockResolvedValue("uploads/2026/03/video.mp3");
    mockGenerateSignedDownloadUrl.mockResolvedValue(
      "https://storage.example.com/signed-url"
    );
    mockSendDistributionErrorNotification.mockResolvedValue(undefined);

    // Suppress console output during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("throws when job is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(processJob("nonexistent")).rejects.toThrow(
      "Job nonexistent not found."
    );
  });

  it("marks the job as processing immediately", async () => {
    const job = makeJob({ platforms: [] });
    mockFindUnique.mockResolvedValue(job);

    await processJob("job-1");

    expect(mockJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: { status: "processing" },
      })
    );
  });

  it("uploads to YouTube and records success", async () => {
    const job = makeJob();
    mockFindUnique.mockResolvedValue(job);
    mockUploadToYouTube.mockResolvedValue({
      videoId: "yt-abc",
      videoUrl: "https://youtube.com/watch?v=yt-abc",
    });

    // Mock the fetch for video download
    const mockBody = {
      [Symbol.asyncIterator]: async function* () {
        yield new Uint8Array([0]);
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: mockBody,
    }) as unknown as typeof fetch;

    const result = await processJob("job-1");

    expect(result.status).toBe("completed");
    expect(
      result.platformResults.find(
        (r: { platform: string }) => r.platform === "youtube"
      )?.status
    ).toBe("completed");
  });

  it("marks unsupported platforms as failed", async () => {
    const job = makeJob({
      platforms: [{ id: "plat-future", platform: "tiktok" }],
    });
    mockFindUnique.mockResolvedValue(job);

    const result = await processJob("job-1");

    expect(
      result.platformResults.find(
        (r: { platform: string }) => r.platform === "tiktok"
      )?.status
    ).toBe("failed");
    expect(
      result.platformResults.find(
        (r: { platform: string }) => r.platform === "tiktok"
      )?.error
    ).toContain("not yet supported");
  });

  it("sends error notification when any platform fails", async () => {
    const job = makeJob({
      platforms: [
        { id: "plat-yt", platform: "youtube" },
        { id: "plat-web", platform: "website" },
      ],
    });
    mockFindUnique.mockResolvedValue(job);

    // YouTube succeeds
    mockUploadToYouTube.mockResolvedValue({
      videoId: "yt-abc",
      videoUrl: "https://youtube.com/watch?v=yt-abc",
    });

    const mockBody = {
      [Symbol.asyncIterator]: async function* () {
        yield new Uint8Array([0]);
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: mockBody,
    }) as unknown as typeof fetch;

    // WordPress fails (simulated by publishToWordPress throwing)
    mockPublishToWordPress.mockRejectedValue(
      new Error("WP API unreachable")
    );

    const result = await processJob("job-1");

    // Job should still be completed because YouTube succeeded
    expect(result.status).toBe("completed");
    expect(mockSendDistributionErrorNotification).toHaveBeenCalledTimes(1);
  });

  it("marks job as failed when all platforms fail", async () => {
    const job = makeJob({
      platforms: [{ id: "plat-yt", platform: "youtube" }],
    });
    mockFindUnique.mockResolvedValue(job);

    // Video download fails
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
    }) as unknown as typeof fetch;

    const result = await processJob("job-1");

    expect(result.status).toBe("failed");
    expect(
      result.platformResults.every(
        (r: { status: string }) => r.status === "failed"
      )
    ).toBe(true);
  });
});
