import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @google-cloud/storage before importing the module under test
const mockGetSignedUrl = vi.fn();
const mockDelete = vi.fn();
const mockFile = vi.fn().mockReturnValue({
  getSignedUrl: mockGetSignedUrl,
  delete: mockDelete,
});
const mockBucket = vi.fn().mockReturnValue({ file: mockFile });

vi.mock("@google-cloud/storage", () => {
  return {
    Storage: class MockStorage {
      bucket = mockBucket;
    },
  };
});

describe("GCS Client", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GCS_BUCKET_NAME: "test-bucket",
      GOOGLE_APPLICATION_CREDENTIALS: "/path/to/credentials.json",
    };
    mockGetSignedUrl.mockReset();
    mockDelete.mockReset();
    mockFile.mockClear();
    mockBucket.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("generateSignedUploadUrl", () => {
    it("generates a signed upload URL and returns GCS path", async () => {
      mockGetSignedUrl.mockResolvedValue(["https://storage.googleapis.com/signed-url"]);

      const { generateSignedUploadUrl } = await import("@/lib/gcs");
      const result = await generateSignedUploadUrl("my-video.mp4", "video/mp4");

      expect(result.uploadUrl).toBe("https://storage.googleapis.com/signed-url");
      expect(result.gcsPath).toMatch(/^uploads\/\d{4}\/\d{2}\/\d+-my-video\.mp4$/);

      expect(mockBucket).toHaveBeenCalledWith("test-bucket");
      expect(mockFile).toHaveBeenCalledWith(result.gcsPath);
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          version: "v4",
          action: "resumable",
          contentType: "video/mp4",
        })
      );
    });

    it("sanitizes filenames with special characters", async () => {
      mockGetSignedUrl.mockResolvedValue(["https://storage.googleapis.com/signed-url"]);

      const { generateSignedUploadUrl } = await import("@/lib/gcs");
      const result = await generateSignedUploadUrl(
        "My Video (Final) [2024].mp4",
        "video/mp4"
      );

      expect(result.gcsPath).toMatch(/My_Video__Final___2024_\.mp4$/);
    });
  });

  describe("generateSignedDownloadUrl", () => {
    it("generates a signed download URL", async () => {
      mockGetSignedUrl.mockResolvedValue([
        "https://storage.googleapis.com/download-url",
      ]);

      const { generateSignedDownloadUrl } = await import("@/lib/gcs");
      const url = await generateSignedDownloadUrl("uploads/2026/03/123-video.mp4");

      expect(url).toBe("https://storage.googleapis.com/download-url");
      expect(mockBucket).toHaveBeenCalledWith("test-bucket");
      expect(mockFile).toHaveBeenCalledWith("uploads/2026/03/123-video.mp4");
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          version: "v4",
          action: "read",
        })
      );
    });
  });

  describe("deleteFile", () => {
    it("deletes a file from GCS", async () => {
      mockDelete.mockResolvedValue([{}]);

      const { deleteFile } = await import("@/lib/gcs");
      await deleteFile("uploads/2026/03/123-video.mp4");

      expect(mockBucket).toHaveBeenCalledWith("test-bucket");
      expect(mockFile).toHaveBeenCalledWith("uploads/2026/03/123-video.mp4");
      expect(mockDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
    });
  });

  describe("missing credentials", () => {
    it("throws descriptive error when GOOGLE_APPLICATION_CREDENTIALS is not set", async () => {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

      const { generateSignedUploadUrl } = await import("@/lib/gcs");

      await expect(
        generateSignedUploadUrl("test.mp4", "video/mp4")
      ).rejects.toThrow("Google Cloud credentials not configured");
    });

    it("throws descriptive error when GCS_BUCKET_NAME is not set", async () => {
      delete process.env.GCS_BUCKET_NAME;

      const { generateSignedUploadUrl } = await import("@/lib/gcs");

      await expect(
        generateSignedUploadUrl("test.mp4", "video/mp4")
      ).rejects.toThrow("GCS bucket name not configured");
    });
  });
});
