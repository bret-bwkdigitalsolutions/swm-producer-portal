import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() values are available inside vi.mock() factories (which are
// hoisted to the top of the file).
const {
  mockExecFile,
  mockBucketUpload,
  mockMkdtemp,
  mockReaddir,
  mockUnlink,
  mockRmdir,
  mockWriteFile,
} = vi.hoisted(() => ({
  // Follows the (cmd, args, opts, cb) callback convention so util.promisify
  // resolves to { stdout, stderr }.
  mockExecFile: vi.fn(
    (_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, r: unknown) => void) =>
      cb(null, { stdout: "", stderr: "" })
  ),
  mockBucketUpload: vi.fn().mockResolvedValue([]),
  mockMkdtemp: vi.fn().mockResolvedValue("/tmp/swm-video-dl-test"),
  mockReaddir: vi.fn().mockResolvedValue(["video.mp3"]),
  mockUnlink: vi.fn().mockResolvedValue(undefined),
  mockRmdir: vi.fn().mockResolvedValue(undefined),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:child_process", () => ({
  default: { execFile: mockExecFile },
  execFile: mockExecFile,
}));

vi.mock("@google-cloud/storage", () => ({
  Storage: function Storage() {
    return {
      bucket: vi.fn(() => ({ upload: mockBucketUpload })),
    };
  },
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdtemp: mockMkdtemp,
    readdir: mockReaddir,
    unlink: mockUnlink,
    rmdir: mockRmdir,
    writeFile: mockWriteFile,
  },
  mkdtemp: mockMkdtemp,
  readdir: mockReaddir,
  unlink: mockUnlink,
  rmdir: mockRmdir,
  writeFile: mockWriteFile,
}));

import { downloadVideoToGcs } from "@/lib/jobs/video-downloader";

describe("downloadVideoToGcs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdtemp.mockResolvedValue("/tmp/swm-video-dl-test");
    mockReaddir.mockResolvedValue(["video.mp3"]);
    mockUnlink.mockResolvedValue(undefined);
    mockRmdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockBucketUpload.mockResolvedValue([]);
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, r: unknown) => void) =>
        cb(null, { stdout: "", stderr: "" })
    );
    process.env.GCS_BUCKET_NAME = "test-bucket";
    process.env.GCS_CREDENTIALS_JSON = JSON.stringify({ type: "service_account" });
    delete process.env.YOUTUBE_COOKIES;
  });

  it("returns a GCS path labeled with the YouTube video ID", async () => {
    const result = await downloadVideoToGcs(
      "https://www.youtube.com/watch?v=abc123xyz",
      "job-1"
    );
    expect(result).toMatch(/uploads\/\d{4}\/\d{2}\/\d+-youtube-abc123xyz\.mp3/);
  });

  it("returns a GCS path labeled with the Vimeo video ID", async () => {
    const result = await downloadVideoToGcs("https://vimeo.com/123456789", "job-1");
    expect(result).toMatch(/uploads\/\d{4}\/\d{2}\/\d+-vimeo-123456789\.mp3/);
  });

  it("calls yt-dlp with the source URL and audio extraction args", async () => {
    await downloadVideoToGcs("https://vimeo.com/123456789", "job-1");
    expect(mockExecFile).toHaveBeenCalledWith(
      "yt-dlp",
      expect.arrayContaining(["-x", "--audio-format", "mp3", "https://vimeo.com/123456789"]),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it("uploads to GCS with the generated path", async () => {
    const result = await downloadVideoToGcs("https://vimeo.com/123456789", "job-1");
    expect(mockBucketUpload).toHaveBeenCalledWith(
      "/tmp/swm-video-dl-test/video.mp3",
      expect.objectContaining({ destination: result })
    );
  });

  it("passes --cookies when YOUTUBE_COOKIES is set", async () => {
    process.env.YOUTUBE_COOKIES = "# Netscape HTTP Cookie File\n";
    await downloadVideoToGcs("https://www.youtube.com/watch?v=abc123xyz", "job-1");
    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain("--cookies");
  });

  it("throws for a URL that is neither YouTube nor Vimeo", async () => {
    await expect(
      downloadVideoToGcs("https://example.com/video/123", "job-1")
    ).rejects.toThrow("Invalid video URL");
  });
});
