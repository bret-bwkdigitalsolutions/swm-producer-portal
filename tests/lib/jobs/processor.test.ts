import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockFindUnique = vi.fn();
const mockJobUpdate = vi.fn();
const mockPlatformUpdate = vi.fn();
const mockUserFindUnique = vi.fn();
const mockShowMetadataFindUnique = vi.fn();
const mockPlatformCredentialFindUnique = vi.fn();
const mockShowPlatformLinkFindUnique = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => {
  const dbMock: Record<string, unknown> = {
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
    showMetadata: {
      findUnique: (...args: unknown[]) => mockShowMetadataFindUnique(...args),
    },
    platformCredential: {
      findUnique: (...args: unknown[]) => mockPlatformCredentialFindUnique(...args),
    },
    showPlatformLink: {
      findUnique: (...args: unknown[]) => mockShowPlatformLinkFindUnique(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    // mergeJobMetadata runs its merge inside a transaction — hand the
    // callback the same mock client.
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(dbMock),
  };
  return { db: dbMock };
});

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
const mockGcsObjectExists = vi.fn();

vi.mock("@/lib/platforms/youtube", () => ({
  uploadToYouTube: (...args: unknown[]) => mockUploadToYouTube(...args),
  addToPlaylist: (...args: unknown[]) => mockAddToPlaylist(...args),
  setThumbnail: vi.fn(),
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
  derivedGcsAudioPath: (gcsVideoPath: string) =>
    gcsVideoPath.replace(/\.[^.]+$/, ".mp3"),
}));

vi.mock("@/lib/gcs", () => ({
  generateSignedDownloadUrl: (...args: unknown[]) =>
    mockGenerateSignedDownloadUrl(...args),
  uploadBuffer: vi.fn().mockResolvedValue("uploads/mock-path"),
  gcsObjectExists: (...args: unknown[]) => mockGcsObjectExists(...args),
}));

vi.mock("@/lib/transcription", () => ({
  transcribeAudio: vi.fn().mockRejectedValue(new Error("not mocked")),
  formatTranscriptForAI: vi.fn().mockReturnValue(""),
  formatTranscriptForDisplay: vi.fn().mockReturnValue(""),
}));

vi.mock("@/lib/jobs/video-downloader", () => ({
  downloadVideoToGcs: vi.fn(),
  downloadFullVideoToGcs: vi.fn(),
}));

// Mock AI processor (unused in new processor but imported)
vi.mock("@/lib/jobs/ai-processor", () => ({
  generateAiSuggestions: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { processJob } from "@/lib/jobs/processor";
import { downloadFullVideoToGcs } from "@/lib/jobs/video-downloader";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIGNED_URL = "https://storage.example.com/signed-url";

function videoFetchResponse() {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    }),
  };
}

function installVideoFetch() {
  globalThis.fetch = vi.fn().mockImplementation(async () => videoFetchResponse()) as unknown as typeof fetch;
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

function signedDownloadCount(): number {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls.filter((call) => call[0] === SIGNED_URL).length;
}

function leftoverVideoDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith("swm-yt-"));
}

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
    mockGcsObjectExists.mockResolvedValue(true);
    mockGenerateSignedDownloadUrl.mockResolvedValue(SIGNED_URL);
    mockSendDistributionErrorNotification.mockResolvedValue(undefined);
    mockShowMetadataFindUnique.mockResolvedValue(null);
    mockPlatformCredentialFindUnique.mockResolvedValue(null);
    mockShowPlatformLinkFindUnique.mockResolvedValue(null);
    mockQueryRaw.mockResolvedValue([{ metadata: {} }]);

    // Suppress console output during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const name of leftoverVideoDirs()) {
      await rm(join(tmpdir(), name), { recursive: true, force: true });
    }
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

    // Mock the fetch for video download — must be a real web ReadableStream
    // because the processor pipes it via Readable.fromWeb().
    installVideoFetch();

    const result = await processJob("job-1");

    expect(mockGenerateSignedDownloadUrl).toHaveBeenCalledTimes(1);
    expect(mockGenerateSignedDownloadUrl).toHaveBeenCalledWith(
      "uploads/2026/03/video.mp4"
    );
    expect(signedDownloadCount()).toBe(1);
    expect(leftoverVideoDirs()).toEqual([]);

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

    installVideoFetch();

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
    // YouTube-only: one attempt, then the partial temp dir is removed.
    expect(mockGenerateSignedDownloadUrl).toHaveBeenCalledTimes(1);
    expect(leftoverVideoDirs()).toEqual([]);
  });

  it("reads an uploaded video from GCS once and reuses it for audio and YouTube", async () => {
    const job = makeJob({
      platforms: [
        { id: "plat-yt", platform: "youtube" },
        { id: "plat-tr", platform: "transistor" },
      ],
    });
    mockFindUnique.mockResolvedValue(job);
    installVideoFetch();
    mockUploadToYouTube.mockResolvedValue({
      videoId: "yt-abc",
      videoUrl: "https://youtube.com/watch?v=yt-abc",
    });
    mockUploadToTransistor.mockResolvedValue({
      episodeId: "ep-1",
      episodeUrl: "https://transistor.fm/ep-1",
    });

    let videoPath = "";
    mockExtractAudio.mockImplementation(async (_gcsPath: string, options?: { localVideoPath?: string }) => {
      videoPath = options?.localVideoPath ?? "";
      expect(videoPath).not.toBe("");
      expect(existsSync(videoPath)).toBe(true);
      return "uploads/2026/03/video.mp3";
    });

    const before = new Set(leftoverVideoDirs());
    const result = await processJob("job-1");

    expect(result.status).toBe("completed");
    expect(mockGenerateSignedDownloadUrl).toHaveBeenCalledTimes(1);
    expect(mockGenerateSignedDownloadUrl).toHaveBeenCalledWith(
      "uploads/2026/03/video.mp4"
    );
    expect(signedDownloadCount()).toBe(1);
    expect(mockExtractAudio).toHaveBeenCalledWith("uploads/2026/03/video.mp4", {
      localVideoPath: videoPath,
    });
    expect(mockUploadToYouTube).toHaveBeenCalledWith(
      expect.objectContaining({ videoFilePath: videoPath })
    );
    expect(existsSync(videoPath)).toBe(false);
    expect(leftoverVideoDirs().filter((name) => !before.has(name))).toEqual([]);
    expect(mockJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            gcsAudioPath: "uploads/2026/03/video.mp3",
          }),
        }),
      })
    );
  });

  it("reuses audio from the AI analyze step and reads the video only for YouTube", async () => {
    const job = makeJob({
      metadata: {
        description: "A test episode",
        transcript: "already transcribed",
        gcsAudioPath: "uploads/2026/03/video.mp3",
      },
      platforms: [
        { id: "plat-yt", platform: "youtube" },
        { id: "plat-tr", platform: "transistor" },
      ],
    });
    mockFindUnique.mockResolvedValue(job);
    installVideoFetch();
    mockUploadToYouTube.mockResolvedValue({
      videoId: "yt-abc",
      videoUrl: "https://youtube.com/watch?v=yt-abc",
    });
    mockUploadToTransistor.mockResolvedValue({
      episodeId: "ep-1",
      episodeUrl: "https://transistor.fm/ep-1",
    });

    const result = await processJob("job-1");

    expect(result.status).toBe("completed");
    expect(mockGcsObjectExists).toHaveBeenCalledWith("uploads/2026/03/video.mp3");
    expect(mockExtractAudio).not.toHaveBeenCalled();
    expect(signedDownloadCount()).toBe(1);
    expect(mockUploadToTransistor).toHaveBeenCalledWith(
      expect.objectContaining({ gcsAudioPath: "uploads/2026/03/video.mp3" })
    );
    expect(leftoverVideoDirs()).toEqual([]);
  });

  it("does not read the video when a retry only needs Transistor and audio is already extracted", async () => {
    const job = makeJob({
      metadata: {
        description: "A test episode",
        gcsAudioPath: "uploads/2026/03/video.mp3",
        transcript: "already transcribed",
      },
      platforms: [
        {
          id: "plat-yt",
          platform: "youtube",
          status: "completed",
          externalId: "yt-abc",
          externalUrl: "https://youtube.com/watch?v=yt-abc",
        },
        { id: "plat-tr", platform: "transistor", status: "failed" },
      ],
    });
    mockFindUnique.mockResolvedValue(job);
    installVideoFetch();
    mockUploadToTransistor.mockResolvedValue({
      episodeId: "ep-1",
      episodeUrl: "https://transistor.fm/ep-1",
    });

    const result = await processJob("job-1");

    expect(result.platformResults.find((r) => r.platform === "transistor")?.status).toBe(
      "completed"
    );
    expect(mockExtractAudio).not.toHaveBeenCalled();
    expect(mockGenerateSignedDownloadUrl).not.toHaveBeenCalled();
    expect(signedDownloadCount()).toBe(0);
    expect(mockUploadToTransistor).toHaveBeenCalledWith(
      expect.objectContaining({ gcsAudioPath: "uploads/2026/03/video.mp3" })
    );
  });

  it("extracts again when the stored audio object is missing", async () => {
    const job = makeJob({
      metadata: {
        description: "A test episode",
        gcsAudioPath: "uploads/2026/03/video.mp3",
        transcript: "already transcribed",
      },
      platforms: [
        { id: "plat-yt", platform: "youtube" },
        { id: "plat-tr", platform: "transistor" },
      ],
    });
    mockFindUnique.mockResolvedValue(job);
    installVideoFetch();
    mockGcsObjectExists.mockResolvedValue(false);
    mockUploadToYouTube.mockResolvedValue({
      videoId: "yt-abc",
      videoUrl: "https://youtube.com/watch?v=yt-abc",
    });
    mockUploadToTransistor.mockResolvedValue({
      episodeId: "ep-1",
      episodeUrl: "https://transistor.fm/ep-1",
    });

    const result = await processJob("job-1");

    expect(result.status).toBe("completed");
    expect(mockExtractAudio).toHaveBeenCalledTimes(1);
    expect(signedDownloadCount()).toBe(1);
    expect(leftoverVideoDirs()).toEqual([]);
  });

  it("ignores stored audio that belongs to a different object", async () => {
    const job = makeJob({
      metadata: {
        description: "A test episode",
        gcsAudioPath: "uploads/2026/01/other-episode.mp3",
      },
      platforms: [
        { id: "plat-yt", platform: "youtube" },
        { id: "plat-tr", platform: "transistor" },
      ],
    });
    mockFindUnique.mockResolvedValue(job);
    installVideoFetch();
    mockUploadToYouTube.mockResolvedValue({
      videoId: "yt-abc",
      videoUrl: "https://youtube.com/watch?v=yt-abc",
    });
    mockUploadToTransistor.mockResolvedValue({
      episodeId: "ep-1",
      episodeUrl: "https://transistor.fm/ep-1",
    });

    await processJob("job-1");

    expect(mockGcsObjectExists).not.toHaveBeenCalled();
    expect(mockExtractAudio).toHaveBeenCalledTimes(1);
    expect(signedDownloadCount()).toBe(1);
  });

  it("does not download the video when only Transistor still needs work", async () => {
    const job = makeJob({
      platforms: [
        {
          id: "plat-yt",
          platform: "youtube",
          status: "completed",
          externalId: "yt-abc",
          externalUrl: "https://youtube.com/watch?v=yt-abc",
        },
        { id: "plat-tr", platform: "transistor", status: "failed" },
      ],
    });
    mockFindUnique.mockResolvedValue(job);
    installVideoFetch();
    mockUploadToTransistor.mockResolvedValue({
      episodeId: "ep-1",
      episodeUrl: "https://transistor.fm/ep-1",
    });

    const result = await processJob("job-1");

    expect(result.platformResults.find((r) => r.platform === "transistor")?.status).toBe(
      "completed"
    );
    expect(mockExtractAudio).toHaveBeenCalledTimes(1);
    expect(mockExtractAudio).toHaveBeenCalledWith("uploads/2026/03/video.mp4");
    expect(mockGenerateSignedDownloadUrl).not.toHaveBeenCalled();
    expect(mockUploadToYouTube).not.toHaveBeenCalled();
    expect(leftoverVideoDirs()).toEqual([]);
  });

  it("keeps the shared file for YouTube when audio extraction fails, and still cleans it up", async () => {
    const job = makeJob({
      platforms: [
        { id: "plat-yt", platform: "youtube" },
        { id: "plat-tr", platform: "transistor" },
      ],
    });
    mockFindUnique.mockResolvedValue(job);
    installVideoFetch();
    mockUploadToYouTube.mockResolvedValue({
      videoId: "yt-abc",
      videoUrl: "https://youtube.com/watch?v=yt-abc",
    });

    let videoPath = "";
    mockExtractAudio.mockImplementation(async (_gcsPath: string, options?: { localVideoPath?: string }) => {
      videoPath = options?.localVideoPath ?? "";
      expect(existsSync(videoPath)).toBe(true);
      throw new Error("ffmpeg failed");
    });

    const result = await processJob("job-1");

    expect(mockGenerateSignedDownloadUrl).toHaveBeenCalledTimes(1);
    expect(signedDownloadCount()).toBe(1);
    expect(mockUploadToYouTube).toHaveBeenCalledWith(
      expect.objectContaining({ videoFilePath: videoPath })
    );
    expect(result.platformResults.find((r) => r.platform === "transistor")?.status).toBe(
      "failed"
    );
    expect(result.platformResults.find((r) => r.platform === "youtube")?.status).toBe(
      "completed"
    );
    expect(existsSync(videoPath)).toBe(false);
    expect(leftoverVideoDirs()).toEqual([]);
  });

  it("lets YouTube retry the download when the shared read fails, then removes temp dirs", async () => {
    const job = makeJob({
      platforms: [
        { id: "plat-yt", platform: "youtube" },
        { id: "plat-tr", platform: "transistor" },
      ],
    });
    mockFindUnique.mockResolvedValue(job);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
    }) as unknown as typeof fetch;

    const result = await processJob("job-1");

    // Shared attempt, then YouTube's own attempt. Not a third read from extractAudio.
    expect(mockGenerateSignedDownloadUrl).toHaveBeenCalledTimes(2);
    expect(signedDownloadCount()).toBe(2);
    expect(mockExtractAudio).not.toHaveBeenCalled();
    expect(result.platformResults.find((r) => r.platform === "transistor")?.error).toBe(
      "Failed to download video: 503"
    );
    expect(result.platformResults.find((r) => r.platform === "youtube")?.error).toBe(
      "Video file not available for YouTube upload."
    );
    expect(leftoverVideoDirs()).toEqual([]);
  });

  it("removes the downloaded video when processing throws after the download", async () => {
    const job = makeJob({
      platforms: [
        { id: "plat-yt", platform: "youtube" },
        { id: "plat-tr", platform: "transistor" },
      ],
    });
    mockFindUnique
      .mockResolvedValueOnce(job)
      .mockRejectedValueOnce(new Error("db exploded"));
    installVideoFetch();

    let videoPath = "";
    mockExtractAudio.mockImplementation(async (_gcsPath: string, options?: { localVideoPath?: string }) => {
      videoPath = options?.localVideoPath ?? "";
      expect(existsSync(videoPath)).toBe(true);
      return "uploads/2026/03/video.mp3";
    });

    const result = await processJob("job-1");

    expect(result.status).toBe("failed");
    expect(result.platformResults[0]?.error).toContain("db exploded");
    expect(signedDownloadCount()).toBe(1);
    expect(videoPath).not.toBe("");
    expect(existsSync(videoPath)).toBe(false);
    expect(leftoverVideoDirs()).toEqual([]);
  });

  it("reads a Vimeo full video from GCS once for the YouTube upload", async () => {
    const job = makeJob({
      gcsPath: "uploads/2026/03/vimeo-audio.mp3",
      metadata: {
        description: "A test episode",
        existingVimeoUrl: "https://vimeo.com/123456789",
      },
      platforms: [{ id: "plat-yt", platform: "youtube" }],
    });
    mockFindUnique.mockResolvedValue(job);
    installVideoFetch();
    vi.mocked(downloadFullVideoToGcs).mockResolvedValue(
      "uploads/2026/03/vimeo-video.mp4"
    );
    mockUploadToYouTube.mockResolvedValue({
      videoId: "yt-abc",
      videoUrl: "https://youtube.com/watch?v=yt-abc",
    });

    const result = await processJob("job-1");

    expect(result.status).toBe("completed");
    expect(downloadFullVideoToGcs).toHaveBeenCalledTimes(1);
    expect(mockGenerateSignedDownloadUrl).toHaveBeenCalledTimes(1);
    expect(mockGenerateSignedDownloadUrl).toHaveBeenCalledWith(
      "uploads/2026/03/vimeo-video.mp4"
    );
    expect(signedDownloadCount()).toBe(1);
    expect(mockExtractAudio).not.toHaveBeenCalled();
    expect(leftoverVideoDirs()).toEqual([]);
  });
});
