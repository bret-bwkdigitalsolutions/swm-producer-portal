import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() values are available inside vi.mock() factories (which are hoisted to top of file)
const {
  mockBucketUpload,
  mockCreateWriteStream,
  mockPipeline,
  mockMkdtemp,
  mockUnlink,
} = vi.hoisted(() => {
  const { Writable } = require("node:stream");
  return {
    mockBucketUpload: vi.fn().mockResolvedValue([]),
    mockCreateWriteStream: vi.fn(() =>
      new Writable({ write(_c: any, _e: any, cb: () => void) { cb(); } })
    ),
    mockPipeline: vi.fn().mockResolvedValue(undefined),
    mockMkdtemp: vi.fn().mockResolvedValue("/tmp/swm-yt-dl-test"),
    mockUnlink: vi.fn().mockResolvedValue(undefined),
  };
});

// Must mock I/O before importing the module
vi.mock("@distube/ytdl-core", () => {
  const { Readable } = require("node:stream");
  const mockYtdl = vi.fn((_url: string) => {
    const stream = new Readable({ read() {} });
    process.nextTick(() => {
      stream.push(Buffer.from("fake-video-data"));
      stream.push(null);
    });
    return stream;
  });
  return { default: mockYtdl };
});

vi.mock("@google-cloud/storage", () => ({
  Storage: function Storage() {
    return {
      bucket: vi.fn(() => ({ upload: mockBucketUpload })),
    };
  },
}));

vi.mock("node:fs", () => ({
  default: { createWriteStream: mockCreateWriteStream },
  createWriteStream: mockCreateWriteStream,
}));

vi.mock("node:stream/promises", () => ({
  default: { pipeline: mockPipeline },
  pipeline: mockPipeline,
}));

vi.mock("node:fs/promises", () => ({
  default: { mkdtemp: mockMkdtemp, unlink: mockUnlink },
  mkdtemp: mockMkdtemp,
  unlink: mockUnlink,
  rmdir: vi.fn().mockResolvedValue(undefined),
}));

import { downloadYouTubeVideoToGcs } from "@/lib/jobs/youtube-video-downloader";
import ytdl from "@distube/ytdl-core";

describe("downloadYouTubeVideoToGcs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore return values cleared by vi.clearAllMocks()
    mockMkdtemp.mockResolvedValue("/tmp/swm-yt-dl-test");
    mockPipeline.mockResolvedValue(undefined);
    mockBucketUpload.mockResolvedValue([]);
    process.env.GCS_BUCKET_NAME = "test-bucket";
    process.env.GCS_CREDENTIALS_JSON = JSON.stringify({ type: "service_account" });
  });

  it("returns a GCS path containing the video ID", async () => {
    const result = await downloadYouTubeVideoToGcs(
      "https://www.youtube.com/watch?v=abc123xyz",
      "job-1"
    );
    expect(result).toMatch(/uploads\/\d{4}\/\d{2}\/\d+-youtube-abc123xyz\.mp4/);
  });

  it("calls ytdl with the YouTube URL and audioandvideo filter", async () => {
    await downloadYouTubeVideoToGcs(
      "https://www.youtube.com/watch?v=abc123xyz",
      "job-1"
    );
    expect(ytdl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abc123xyz",
      expect.objectContaining({ filter: "audioandvideo" })
    );
  });

  it("uploads to GCS with the generated path", async () => {
    const result = await downloadYouTubeVideoToGcs(
      "https://www.youtube.com/watch?v=abc123xyz",
      "job-1"
    );
    expect(mockBucketUpload).toHaveBeenCalledWith(
      "/tmp/swm-yt-dl-test/video.mp4",
      expect.objectContaining({ destination: result })
    );
  });

  it("throws for a URL with no video ID", async () => {
    await expect(
      downloadYouTubeVideoToGcs("https://www.youtube.com/playlist?list=abc", "job-1")
    ).rejects.toThrow("Invalid YouTube URL: missing video ID");
  });

  it("throws for a non-YouTube URL", async () => {
    await expect(
      downloadYouTubeVideoToGcs("https://vimeo.com/123456", "job-1")
    ).rejects.toThrow("Invalid YouTube URL");
  });
});
