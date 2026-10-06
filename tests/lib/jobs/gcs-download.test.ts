import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockGenerateSignedDownloadUrl = vi.fn();

vi.mock("@/lib/gcs", () => ({
  generateSignedDownloadUrl: (...args: unknown[]) =>
    mockGenerateSignedDownloadUrl(...args),
}));

import { downloadGcsObjectToFile } from "@/lib/jobs/gcs-download";

describe("downloadGcsObjectToFile", () => {
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGenerateSignedDownloadUrl.mockResolvedValue(
      "https://storage.example.com/signed"
    );
    dir = await mkdtemp(join(tmpdir(), "swm-gcs-dl-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the object once and does not issue a second request", async () => {
    const dest = join(dir, "video.mp4");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([9, 8, 7]));
          controller.close();
        },
      }),
    }) as unknown as typeof fetch;

    await downloadGcsObjectToFile("uploads/2026/03/video.mp4", dest);

    expect(mockGenerateSignedDownloadUrl).toHaveBeenCalledTimes(1);
    expect(mockGenerateSignedDownloadUrl).toHaveBeenCalledWith(
      "uploads/2026/03/video.mp4"
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://storage.example.com/signed"
    );
    expect(Array.from(await readFile(dest))).toEqual([9, 8, 7]);
  });

  it("throws the existing download error and does not create a file when GCS rejects", async () => {
    const dest = join(dir, "video.mp4");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
    }) as unknown as typeof fetch;

    await expect(
      downloadGcsObjectToFile("uploads/2026/03/video.mp4", dest)
    ).rejects.toThrow("Failed to download video: 503");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await expect(readFile(dest)).rejects.toThrow();
  });

  it("uses a caller-supplied error prefix", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      body: null,
    }) as unknown as typeof fetch;

    await expect(
      downloadGcsObjectToFile("uploads/vimeo.mp4", join(dir, "v.mp4"), {
        errorPrefix: "Failed to download Vimeo video from GCS",
      })
    ).rejects.toThrow("Failed to download Vimeo video from GCS: 404");
  });
});
