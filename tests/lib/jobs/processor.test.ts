import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockFindFirst = vi.fn();
const mockJobUpdate = vi.fn();
const mockPlatformUpdate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    distributionJob: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      update: (...args: unknown[]) => mockJobUpdate(...args),
    },
    distributionJobPlatform: {
      update: (...args: unknown[]) => mockPlatformUpdate(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock AI processor (called on success)
// ---------------------------------------------------------------------------

const mockGenerateAiSuggestions = vi.fn();

vi.mock("@/lib/jobs/ai-processor", () => ({
  generateAiSuggestions: (...args: unknown[]) =>
    mockGenerateAiSuggestions(...args),
}));

// ---------------------------------------------------------------------------
// Mock audio extractor
// ---------------------------------------------------------------------------

vi.mock("@/lib/jobs/audio-extractor", () => ({
  extractAudio: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { processNextJob } from "@/lib/jobs/processor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    title: "Episode 1",
    status: "pending",
    gcsPath: "uploads/2026/03/video.mp4",
    metadata: { description: "A test episode" },
    platforms: [
      { id: "plat-1", platform: "youtube" },
      { id: "plat-2", platform: "spotify" },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processNextJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // By default, the $transaction mock executes the callback with a fake tx
    // that behaves the same as the top-level db mock.
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        distributionJob: {
          findFirst: mockFindFirst,
          update: mockJobUpdate,
        },
      };
      return fn(tx);
    });

    // Default: platform uploads "succeed" (no throw)
    mockPlatformUpdate.mockResolvedValue({});
    mockJobUpdate.mockResolvedValue({});
    mockGenerateAiSuggestions.mockResolvedValue(undefined);

    // Suppress console output during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns null when there are no pending jobs", async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await processNextJob();
    expect(result).toBeNull();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("picks the oldest pending job and transitions it to processing", async () => {
    const job = makeJob();
    mockFindFirst.mockResolvedValue(job);

    await processNextJob();

    // The transaction should update the job status to "processing"
    expect(mockJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: { status: "processing" },
      })
    );

    // findFirst should have been called with the correct query
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "pending" },
        orderBy: { createdAt: "asc" },
        include: { platforms: true },
      })
    );
  });

  it("moves job to awaiting_review when at least one platform succeeds", async () => {
    const job = makeJob();
    mockFindFirst.mockResolvedValue(job);

    const result = await processNextJob();

    expect(result).not.toBeNull();
    expect(result!.status).toBe("awaiting_review");
    expect(result!.jobId).toBe("job-1");

    // Final status update should be "awaiting_review"
    const lastJobUpdateCall =
      mockJobUpdate.mock.calls[mockJobUpdate.mock.calls.length - 1];
    expect(lastJobUpdateCall[0]).toEqual(
      expect.objectContaining({
        where: { id: "job-1" },
        data: { status: "awaiting_review" },
      })
    );
  });

  it("marks job as failed when all platforms fail", async () => {
    const job = makeJob();
    mockFindFirst.mockResolvedValue(job);

    // Track per-platform call counts so the first update (uploading) throws
    // while the second update (error recording in catch) succeeds.
    const platformCallCounts: Record<string, number> = {};
    mockPlatformUpdate.mockImplementation(
      async (args: { where: { id: string }; data: { status: string } }) => {
        const id = args.where.id;
        platformCallCounts[id] = (platformCallCounts[id] ?? 0) + 1;
        // First call per platform is the "uploading" phase — make it fail
        if (platformCallCounts[id] === 1) {
          throw new Error("Platform unavailable");
        }
        return {};
      }
    );

    const result = await processNextJob();

    expect(result).not.toBeNull();
    expect(result!.status).toBe("failed");
    expect(result!.platformResults.every((r) => r.status === "failed")).toBe(
      true
    );
  });

  it("continues processing other platforms when one fails", async () => {
    const job = makeJob({
      platforms: [
        { id: "plat-1", platform: "youtube" },
        { id: "plat-2", platform: "spotify" },
      ],
    });
    mockFindFirst.mockResolvedValue(job);

    // First platform call chain: fail on the first update (uploading phase)
    // Second platform call chain: succeed
    let callCount = 0;
    mockPlatformUpdate.mockImplementation(async (args: { where: { id: string } }) => {
      callCount++;
      // Fail the first platform's first status update
      if (args.where.id === "plat-1" && callCount <= 1) {
        throw new Error("YouTube API down");
      }
      return {};
    });

    const result = await processNextJob();

    expect(result).not.toBeNull();
    // Overall job should be awaiting_review because spotify succeeded
    expect(result!.status).toBe("awaiting_review");

    const youtubeResult = result!.platformResults.find(
      (r) => r.platform === "youtube"
    );
    const spotifyResult = result!.platformResults.find(
      (r) => r.platform === "spotify"
    );

    expect(youtubeResult!.status).toBe("failed");
    expect(spotifyResult!.status).toBe("completed");
  });

  it("triggers AI suggestion generation after successful platform uploads", async () => {
    const job = makeJob({
      metadata: { transcript: "Hello world" },
    });
    mockFindFirst.mockResolvedValue(job);

    await processNextJob();

    expect(mockGenerateAiSuggestions).toHaveBeenCalledWith(
      "job-1",
      "Hello world"
    );
  });

  it("does not fail the job when AI processing throws", async () => {
    const job = makeJob();
    mockFindFirst.mockResolvedValue(job);
    mockGenerateAiSuggestions.mockRejectedValue(
      new Error("AI service unavailable")
    );

    const result = await processNextJob();

    // Job should still move to awaiting_review despite AI failure
    expect(result).not.toBeNull();
    expect(result!.status).toBe("awaiting_review");
  });

  it("returns platform results for each platform in the job", async () => {
    const job = makeJob({
      platforms: [
        { id: "plat-1", platform: "youtube" },
        { id: "plat-2", platform: "spotify" },
        { id: "plat-3", platform: "apple" },
      ],
    });
    mockFindFirst.mockResolvedValue(job);

    const result = await processNextJob();

    expect(result!.platformResults).toHaveLength(3);
    const platforms = result!.platformResults.map((r) => r.platform);
    expect(platforms).toContain("youtube");
    expect(platforms).toContain("spotify");
    expect(platforms).toContain("apple");
  });
});
