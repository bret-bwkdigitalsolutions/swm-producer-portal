import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() values are available inside vi.mock() factories (which are
// hoisted to the top of the file).
const {
  mockExecFile,
  mockSpawn,
  mockBucketUpload,
  mockCreateWriteStream,
  mockFileDelete,
  mockMkdtemp,
  mockReaddir,
  mockUnlink,
  mockRmdir,
  mockWriteFile,
  mockGetYoutubeCookiesForShow,
} = vi.hoisted(() => ({
  // Follows the (cmd, args, opts, cb) callback convention so util.promisify
  // resolves to { stdout, stderr }.
  mockExecFile: vi.fn(
    (_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, r: unknown) => void) =>
      cb(null, { stdout: "", stderr: "" })
  ),
  mockSpawn: vi.fn(),
  mockBucketUpload: vi.fn().mockResolvedValue([]),
  mockCreateWriteStream: vi.fn(),
  mockFileDelete: vi.fn().mockResolvedValue([]),
  mockMkdtemp: vi.fn().mockResolvedValue("/tmp/swm-video-dl-test"),
  mockReaddir: vi.fn().mockResolvedValue(["video.mp3"]),
  mockUnlink: vi.fn().mockResolvedValue(undefined),
  mockRmdir: vi.fn().mockResolvedValue(undefined),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockGetYoutubeCookiesForShow: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/youtube-identity", () => ({
  getYoutubeCookiesForShow: mockGetYoutubeCookiesForShow,
}));

vi.mock("node:child_process", () => ({
  default: { execFile: mockExecFile, spawn: mockSpawn },
  execFile: mockExecFile,
  spawn: mockSpawn,
}));

vi.mock("@google-cloud/storage", () => ({
  Storage: function Storage() {
    return {
      bucket: vi.fn(() => ({
        upload: mockBucketUpload,
        file: vi.fn(() => ({
          createWriteStream: mockCreateWriteStream,
          delete: mockFileDelete,
        })),
      })),
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

import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { Writable } from "node:stream";
import { downloadVideoToGcs } from "@/lib/jobs/video-downloader";

function fakeYtDlp(closeCode: number | null) {
  const stdout = new EventEmitter() as EventEmitter & { resume: () => void };
  const stderr = new EventEmitter() as EventEmitter & {
    setEncoding: (enc: string) => EventEmitter;
  };
  stdout.resume = () => {};
  stderr.setEncoding = () => stderr;
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => boolean;
  };
  child.pid = 4242;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = () => true;
  if (closeCode != null) {
    setImmediate(() => child.emit("close", closeCode));
  }
  return child;
}

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
    mockGetYoutubeCookiesForShow.mockResolvedValue(null);
  });

  it("returns a GCS path labeled with the YouTube video ID", async () => {
    const result = await downloadVideoToGcs(
      "https://www.youtube.com/watch?v=abc123xyz45",
      "job-1"
    );
    expect(result).toMatch(/uploads\/\d{4}\/\d{2}\/\d+-youtube-abc123xyz45\.mp3/);
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
    await downloadVideoToGcs("https://www.youtube.com/watch?v=abc123xyz45", "job-1");
    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain("--cookies");
  });

  it("throws for a URL that is neither YouTube nor Vimeo", async () => {
    await expect(
      downloadVideoToGcs("https://example.com/video/123", "job-1")
    ).rejects.toThrow("Invalid video URL");
  });

  it("uses per-identity cookies when wpShowId resolves to one, skipping the env var", async () => {
    process.env.YOUTUBE_COOKIES = "# Netscape HTTP Cookie File\n# env-fallback\n";
    mockGetYoutubeCookiesForShow.mockResolvedValue(
      "# Netscape HTTP Cookie File\n# from-identity\n"
    );
    await downloadVideoToGcs(
      "https://www.youtube.com/watch?v=abc123xyz45",
      "job-1",
      42
    );
    expect(mockGetYoutubeCookiesForShow).toHaveBeenCalledWith(42);
    const writeCalls = mockWriteFile.mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const cookiePayload = writeCalls[0][1] as string;
    expect(cookiePayload).toContain("from-identity");
    expect(cookiePayload).not.toContain("env-fallback");
  });

  it("falls back to YOUTUBE_COOKIES env var when no identity cookies exist for the show", async () => {
    process.env.YOUTUBE_COOKIES = "# Netscape HTTP Cookie File\n# env-fallback\n";
    mockGetYoutubeCookiesForShow.mockResolvedValue(null);
    await downloadVideoToGcs(
      "https://www.youtube.com/watch?v=abc123xyz45",
      "job-1",
      42
    );
    const cookiePayload = mockWriteFile.mock.calls[0][1] as string;
    expect(cookiePayload).toContain("env-fallback");
  });

  it("skips the identity lookup entirely when wpShowId is omitted", async () => {
    process.env.YOUTUBE_COOKIES = "# Netscape HTTP Cookie File\n# env-fallback\n";
    await downloadVideoToGcs(
      "https://www.youtube.com/watch?v=abc123xyz45",
      "job-1"
    );
    expect(mockGetYoutubeCookiesForShow).not.toHaveBeenCalled();
    const cookiePayload = mockWriteFile.mock.calls[0][1] as string;
    expect(cookiePayload).toContain("env-fallback");
  });

  it("spawns yt-dlp detached and kills the process group on timeout", async () => {
    mockSpawn.mockImplementation(() => fakeYtDlp(null));
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      await expect(
        downloadVideoToGcs(
          "https://www.youtube.com/watch?v=abc123xyz45",
          "job-1",
          undefined,
          { timeoutMs: 30 }
        )
      ).rejects.toThrow(/timed out/);
      expect(mockSpawn).toHaveBeenCalledWith(
        "yt-dlp",
        expect.any(Array),
        expect.objectContaining({ detached: true })
      );
      expect(kill).toHaveBeenCalledWith(-4242, "SIGKILL");
    } finally {
      kill.mockRestore();
    }
  });

  it("deletes a partial GCS object when the upload deadline aborts", async () => {
    mkdirSync("/tmp/swm-video-dl-test", { recursive: true });
    writeFileSync("/tmp/swm-video-dl-test/video.mp3", "audio");
    mockSpawn.mockImplementation(() => fakeYtDlp(0));
    let sawWrite: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      sawWrite = resolve;
    });
    mockCreateWriteStream.mockImplementation(
      () =>
        new Writable({
          write(_chunk, _encoding, _callback) {
            sawWrite?.();
          },
        })
    );
    const controller = new AbortController();
    const pending = downloadVideoToGcs(
      "https://www.youtube.com/watch?v=abc123xyz45",
      "job-1",
      undefined,
      { timeoutMs: 60_000, signal: controller.signal }
    );
    await started;
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
    expect(mockFileDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});
