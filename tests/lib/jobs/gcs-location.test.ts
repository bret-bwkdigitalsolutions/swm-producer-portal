import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExists = vi.fn();

vi.mock("@/lib/gcs", () => ({
  gcsObjectExists: (...args: unknown[]) => mockExists(...args),
}));

import {
  existingFuseFile,
  locateProducerVideo,
  parseFuseMounts,
  resolveObjectBucket,
} from "@/lib/jobs/gcs-location";

beforeEach(() => {
  mockExists.mockReset();
  process.env.GCS_BUCKET_NAME = "legacy-bucket";
  delete process.env.GCS_UPLOAD_BUCKET_NAME;
  delete process.env.GCS_FUSE_MOUNTS;
});

afterEach(() => {
  delete process.env.GCS_BUCKET_NAME;
  delete process.env.GCS_UPLOAD_BUCKET_NAME;
  delete process.env.GCS_FUSE_MOUNTS;
});

describe("parseFuseMounts", () => {
  it("parses bucket=mount pairs and skips blanks", () => {
    const mounts = parseFuseMounts(
      " swm-producer-uploads-central1=/mnt/gcs-regional, swm-producer-uploads=/mnt/gcs-legacy "
    );
    expect(mounts.get("swm-producer-uploads-central1")).toBe("/mnt/gcs-regional");
    expect(mounts.get("swm-producer-uploads")).toBe("/mnt/gcs-legacy");
  });
});

describe("existingFuseFile", () => {
  it("rejects path traversal and returns a file that is actually mounted", () => {
    const dir = mkdtempSync(join(tmpdir(), "swm-fuse-loc-"));
    mkdirSync(join(dir, "uploads"), { recursive: true });
    writeFileSync(join(dir, "uploads/video.mp4"), "x");
    process.env.GCS_FUSE_MOUNTS = `legacy-bucket=${dir}`;
    try {
      expect(existingFuseFile("legacy-bucket", "../etc/passwd")).toBeNull();
      expect(existingFuseFile("legacy-bucket", "/etc/passwd")).toBeNull();
      expect(existingFuseFile("legacy-bucket", "uploads/missing.mp4")).toBeNull();
      expect(existingFuseFile("legacy-bucket", "uploads/video.mp4")).toBe(
        join(dir, "uploads/video.mp4")
      );
      expect(existingFuseFile("other-bucket", "uploads/video.mp4")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("locateProducerVideo", () => {
  it("does not call the API when only the legacy bucket is configured", async () => {
    const located = await locateProducerVideo("uploads/video.mp4", null);
    expect(located).toEqual({ fusePath: null });
    expect(mockExists).not.toHaveBeenCalled();
  });

  it("trusts a stored bucket hint", async () => {
    process.env.GCS_UPLOAD_BUCKET_NAME = "regional-bucket";
    await expect(resolveObjectBucket("uploads/video.mp4", "regional-bucket")).resolves.toBe(
      "regional-bucket"
    );
    expect(mockExists).not.toHaveBeenCalled();
  });

  it("checks the regional bucket before the legacy bucket", async () => {
    process.env.GCS_UPLOAD_BUCKET_NAME = "regional-bucket";
    mockExists.mockImplementation(async (_path: string, bucket: string) => bucket === "legacy-bucket");
    await expect(resolveObjectBucket("uploads/old.mp4")).resolves.toBe("legacy-bucket");
    expect(mockExists).toHaveBeenNthCalledWith(1, "uploads/old.mp4", "regional-bucket");
    expect(mockExists).toHaveBeenNthCalledWith(2, "uploads/old.mp4", "legacy-bucket");
  });

  it("uses the regional bucket when the object is there and does not check legacy", async () => {
    process.env.GCS_UPLOAD_BUCKET_NAME = "regional-bucket";
    mockExists.mockImplementation(async (_path: string, bucket: string) => bucket === "regional-bucket");
    await expect(resolveObjectBucket("uploads/new.mp4")).resolves.toBe("regional-bucket");
    expect(mockExists).toHaveBeenCalledWith("uploads/new.mp4", "regional-bucket");
    expect(mockExists).not.toHaveBeenCalledWith("uploads/new.mp4", "legacy-bucket");
  });

  it("prefers the regional copy when the object exists in both buckets", async () => {
    process.env.GCS_UPLOAD_BUCKET_NAME = "regional-bucket";
    mockExists.mockResolvedValue(true);
    await expect(resolveObjectBucket("uploads/both.mp3")).resolves.toBe("regional-bucket");
    expect(mockExists).toHaveBeenCalledTimes(1);
    expect(mockExists).toHaveBeenCalledWith("uploads/both.mp3", "regional-bucket");
  });
});
