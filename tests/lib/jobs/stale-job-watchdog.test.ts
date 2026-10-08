import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLOUD_RUN_HEARTBEAT_STALE_MS } from "@/lib/jobs/processing-runtime";

const findMany = vi.fn();
const jobUpdateMany = vi.fn();
const platformUpdateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    distributionJob: {
      findMany: (...args: unknown[]) => findMany(...args),
      updateMany: (...args: unknown[]) => jobUpdateMany(...args),
    },
    distributionJobPlatform: {
      updateMany: (...args: unknown[]) => platformUpdateMany(...args),
    },
  },
}));

import {
  failStaleProcessingJobs,
  isWorkerSignalStale,
  staleWorkerMessage,
} from "@/lib/jobs/stale-job-watchdog";

const STALE_MESSAGE =
  "Worker stopped responding (no heartbeat for 20+ min) - likely out of memory or crashed. Click Retry.";

const now = Date.parse("2026-10-08T00:00:00.000Z");

function ago(ms: number): Date {
  return new Date(now - ms);
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    title: "Beer 30",
    status: "processing",
    updatedAt: ago(CLOUD_RUN_HEARTBEAT_STALE_MS + 60_000),
    metadata: {
      workerHeartbeat: ago(CLOUD_RUN_HEARTBEAT_STALE_MS + 60_000).toISOString(),
    },
    ...overrides,
  };
}

beforeEach(() => {
  findMany.mockReset();
  jobUpdateMany.mockReset();
  platformUpdateMany.mockReset();
  jobUpdateMany.mockResolvedValue({ count: 1 });
  platformUpdateMany.mockResolvedValue({ count: 1 });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("stale worker signal", () => {
  it("uses the shared 20-minute threshold in the producer-facing message", () => {
    expect(CLOUD_RUN_HEARTBEAT_STALE_MS).toBe(20 * 60 * 1000);
    expect(staleWorkerMessage()).toBe(STALE_MESSAGE);
  });

  it("treats a heartbeat at the threshold as fresh and one past it as stale", () => {
    const atThreshold = {
      updatedAt: ago(CLOUD_RUN_HEARTBEAT_STALE_MS * 2),
      metadata: {
        workerHeartbeat: new Date(now - CLOUD_RUN_HEARTBEAT_STALE_MS).toISOString(),
      },
    };
    const pastThreshold = {
      updatedAt: ago(CLOUD_RUN_HEARTBEAT_STALE_MS * 2),
      metadata: {
        workerHeartbeat: new Date(now - CLOUD_RUN_HEARTBEAT_STALE_MS - 1).toISOString(),
      },
    };
    expect(isWorkerSignalStale(atThreshold, now)).toBe(false);
    expect(isWorkerSignalStale(pastThreshold, now)).toBe(true);
  });
});

describe("failStaleProcessingJobs", () => {
  it("fails a stale processing job with the retry message and leaves a fresh heartbeat alone", async () => {
    const stale = job({ id: "job-stale" });
    const fresh = job({
      id: "job-fresh",
      updatedAt: ago(CLOUD_RUN_HEARTBEAT_STALE_MS + 60_000),
      metadata: { workerHeartbeat: ago(30_000).toISOString() },
    });
    findMany.mockResolvedValue([stale, fresh]);

    const result = await failStaleProcessingJobs(now);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "processing" } })
    );
    expect(result.failedIds).toEqual(["job-stale"]);
    expect(jobUpdateMany).toHaveBeenCalledTimes(1);
    expect(jobUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "job-stale",
        status: "processing",
        updatedAt: stale.updatedAt,
      },
      data: { status: "failed", errorMessage: STALE_MESSAGE },
    });
    // Retry is the existing action for a platform whose status is "failed".
    expect(platformUpdateMany).toHaveBeenCalledWith({
      where: {
        jobId: "job-stale",
        status: { in: ["queued", "uploading", "processing"] },
      },
      data: { status: "failed", error: STALE_MESSAGE },
    });
  });

  it("does not fail a job with a recent updatedAt and no heartbeat", async () => {
    findMany.mockResolvedValue([
      job({
        id: "job-railway",
        updatedAt: ago(60_000),
        metadata: {},
      }),
    ]);

    const result = await failStaleProcessingJobs(now);

    expect(result.failedIds).toEqual([]);
    expect(jobUpdateMany).not.toHaveBeenCalled();
    expect(platformUpdateMany).not.toHaveBeenCalled();
  });

  it("fails a processing job that never heartbeated once updatedAt is stale", async () => {
    const stale = job({
      id: "job-silent",
      updatedAt: ago(CLOUD_RUN_HEARTBEAT_STALE_MS + 5_000),
      metadata: {},
    });
    findMany.mockResolvedValue([stale]);

    const result = await failStaleProcessingJobs(now);

    expect(result.failedIds).toEqual(["job-silent"]);
    expect(jobUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("leaves non-processing jobs untouched", async () => {
    findMany.mockResolvedValue([
      job({
        id: "job-done",
        status: "completed",
        updatedAt: ago(CLOUD_RUN_HEARTBEAT_STALE_MS * 2),
        metadata: {
          workerHeartbeat: ago(CLOUD_RUN_HEARTBEAT_STALE_MS * 2).toISOString(),
        },
      }),
      job({
        id: "job-failed",
        status: "failed",
      }),
    ]);

    const result = await failStaleProcessingJobs(now);

    expect(result.checked).toBe(2);
    expect(result.failedIds).toEqual([]);
    expect(jobUpdateMany).not.toHaveBeenCalled();
    expect(platformUpdateMany).not.toHaveBeenCalled();
  });

  it("does not fail platforms when a newer write wins the status update", async () => {
    findMany.mockResolvedValue([job({ id: "job-racing" })]);
    jobUpdateMany.mockResolvedValue({ count: 0 });

    const result = await failStaleProcessingJobs(now);

    expect(result.failedIds).toEqual([]);
    expect(platformUpdateMany).not.toHaveBeenCalled();
  });
});
