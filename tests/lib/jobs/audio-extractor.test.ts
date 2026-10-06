import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockExecFile,
  mockBucketUpload,
  mockMkdtemp,
  mockRm,
  mockDownload,
} = vi.hoisted(() => ({
  mockExecFile: vi.fn(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: unknown, result: unknown) => void) =>
      cb(null, { stdout: "", stderr: "" })
  ),
  mockBucketUpload: vi.fn().mockResolvedValue([]),
  mockMkdtemp: vi.fn().mockResolvedValue("/tmp/swm-audio-test"),
  mockRm: vi.fn().mockResolvedValue(undefined),
  mockDownload: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:child_process", () => ({
  default: { execFile: mockExecFile },
  execFile: mockExecFile,
}));

vi.mock("@google-cloud/storage", () => ({
  Storage: function Storage() {
    return { bucket: () => ({ upload: mockBucketUpload }) };
  },
}));

vi.mock("node:fs/promises", () => ({
  default: { mkdtemp: mockMkdtemp, rm: mockRm },
  mkdtemp: mockMkdtemp,
  rm: mockRm,
}));

vi.mock("@/lib/jobs/gcs-download", () => ({
  downloadGcsObjectToFile: (...args: unknown[]) => mockDownload(...args),
}));

import { derivedGcsAudioPath, extractAudio } from "@/lib/jobs/audio-extractor";

describe("derivedGcsAudioPath", () => {
  it("replaces the video extension and leaves other dots in the name", () => {
    expect(derivedGcsAudioPath("uploads/2026/03/episode.final.mp4")).toBe(
      "uploads/2026/03/episode.final.mp3"
    );
  });
});

describe("extractAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdtemp.mockResolvedValue("/tmp/swm-audio-test");
    mockRm.mockResolvedValue(undefined);
    mockDownload.mockResolvedValue(undefined);
    mockBucketUpload.mockResolvedValue([]);
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: unknown, result: unknown) => void) =>
        cb(null, { stdout: "", stderr: "" })
    );
    process.env.GCS_BUCKET_NAME = "test-bucket";
    process.env.GCS_CREDENTIALS_JSON = JSON.stringify({ type: "service_account" });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("downloads the video when no local file is provided, then removes the temp dir", async () => {
    const result = await extractAudio("uploads/2026/03/episode.mp4");

    expect(result).toBe("uploads/2026/03/episode.mp3");
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload).toHaveBeenCalledWith(
      "uploads/2026/03/episode.mp4",
      "/tmp/swm-audio-test/input.mp4"
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining([
        "-i",
        "/tmp/swm-audio-test/input.mp4",
        "/tmp/swm-audio-test/output.mp3",
      ]),
      expect.objectContaining({ timeout: 30 * 60 * 1000 }),
      expect.any(Function)
    );
    expect(mockBucketUpload).toHaveBeenCalledWith(
      "/tmp/swm-audio-test/output.mp3",
      expect.objectContaining({
        destination: "uploads/2026/03/episode.mp3",
        metadata: { contentType: "audio/mpeg" },
      })
    );
    expect(mockRm).toHaveBeenCalledWith("/tmp/swm-audio-test", {
      recursive: true,
      force: true,
    });
  });

  it("reuses a local video and does not read it from GCS or delete it", async () => {
    const localVideo = "/tmp/swm-yt-shared/video.mp4";

    const result = await extractAudio("uploads/2026/03/episode.mp4", {
      localVideoPath: localVideo,
    });

    expect(result).toBe("uploads/2026/03/episode.mp3");
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockExecFile).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining(["-i", localVideo]),
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockRm).toHaveBeenCalledTimes(1);
    expect(mockRm).toHaveBeenCalledWith("/tmp/swm-audio-test", {
      recursive: true,
      force: true,
    });
    expect(mockRm).not.toHaveBeenCalledWith(
      localVideo,
      expect.anything()
    );
  });

  it("still removes the temp dir when ffmpeg fails, and leaves a borrowed video in place", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: unknown, result: unknown) => void) =>
        cb(new Error("ffmpeg failed"), null)
    );
    const localVideo = "/tmp/swm-yt-shared/video.mp4";

    await expect(
      extractAudio("uploads/2026/03/episode.mp4", { localVideoPath: localVideo })
    ).rejects.toThrow("ffmpeg failed");

    expect(mockBucketUpload).not.toHaveBeenCalled();
    expect(mockRm).toHaveBeenCalledWith("/tmp/swm-audio-test", {
      recursive: true,
      force: true,
    });
    expect(mockRm).not.toHaveBeenCalledWith(localVideo, expect.anything());
  });

  it("removes the downloaded video when the GCS read fails", async () => {
    mockDownload.mockRejectedValue(new Error("Failed to download video: 500"));

    await expect(extractAudio("uploads/2026/03/episode.mp4")).rejects.toThrow(
      "Failed to download video: 500"
    );

    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockRm).toHaveBeenCalledWith("/tmp/swm-audio-test", {
      recursive: true,
      force: true,
    });
  });
});
