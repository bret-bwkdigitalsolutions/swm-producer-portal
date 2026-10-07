import { afterEach, describe, expect, it } from "vitest";
import {
  CLOUD_RUN_HEARTBEAT_STALE_MS,
  CLOUD_RUN_JOB_TIMEOUT_MS,
  RAILWAY_JOB_TIMEOUT_MS,
  buildCloudRunRunRequest,
  getProcessingRuntime,
  isAnalyzeStale,
  isCloudRunWorkerFresh,
  jobTimeoutMs,
  mediaToolTimeoutMs,
} from "@/lib/jobs/processing-runtime";

const ENV_KEYS = [
  "VIDEO_PROCESSING_RUNTIME",
  "VIDEO_WORKER",
  "CLOUD_RUN_JOB",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("getProcessingRuntime", () => {
  it("defaults to railway", () => {
    delete process.env.VIDEO_PROCESSING_RUNTIME;
    expect(getProcessingRuntime()).toBe("railway");
  });

  it("accepts cloudrun and treats unknown values as railway", () => {
    process.env.VIDEO_PROCESSING_RUNTIME = "cloudrun";
    expect(getProcessingRuntime()).toBe("cloudrun");
    process.env.VIDEO_PROCESSING_RUNTIME = "lambda";
    expect(getProcessingRuntime()).toBe("railway");
  });
});

describe("timeouts", () => {
  it("keeps the Railway ceilings unless this process is the worker", () => {
    delete process.env.VIDEO_WORKER;
    expect(jobTimeoutMs()).toBe(RAILWAY_JOB_TIMEOUT_MS);
    expect(mediaToolTimeoutMs()).toBe(30 * 60 * 1000);
  });

  it("raises the ceilings on the Cloud Run worker", () => {
    process.env.VIDEO_WORKER = "1";
    expect(jobTimeoutMs()).toBe(CLOUD_RUN_JOB_TIMEOUT_MS);
    expect(jobTimeoutMs()).toBeLessThan(24 * 60 * 60 * 1000);
    expect(mediaToolTimeoutMs()).toBe(20 * 60 * 60 * 1000);
  });
});

describe("buildCloudRunRunRequest", () => {
  it("passes only the job id and mode", () => {
    process.env.CLOUD_RUN_JOB =
      "projects/swm-producer-portal/locations/us-central1/jobs/swm-video-processor";
    const { url, body } = buildCloudRunRunRequest("job-1", "process");
    expect(url).toBe(
      "https://run.googleapis.com/v2/projects/swm-producer-portal/locations/us-central1/jobs/swm-video-processor:run"
    );
    const env = body.overrides.containerOverrides[0].env;
    expect(env).toEqual([
      { name: "VIDEO_WORKER_JOB_ID", value: "job-1" },
      { name: "VIDEO_WORKER_MODE", value: "process" },
    ]);
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });

  it("rejects a job name that is not a full resource", () => {
    process.env.CLOUD_RUN_JOB = "swm-video-processor";
    expect(() => buildCloudRunRunRequest("job-1", "analyze")).toThrow(/CLOUD_RUN_JOB/);
  });
});

describe("heartbeat freshness", () => {
  const now = Date.parse("2026-10-07T15:00:00.000Z");

  it("treats a recent Cloud Run heartbeat as live", () => {
    const metadata = {
      processingRuntime: "cloudrun",
      workerHeartbeat: new Date(now - 60_000).toISOString(),
    };
    expect(isCloudRunWorkerFresh(metadata, now)).toBe(true);
    expect(isAnalyzeStale(metadata, { startedAt: "2020-01-01T00:00:00.000Z" }, now)).toBe(
      false
    );
  });

  it("treats a missed heartbeat as stale", () => {
    const metadata = {
      processingRuntime: "cloudrun",
      workerHeartbeat: new Date(now - CLOUD_RUN_HEARTBEAT_STALE_MS - 1).toISOString(),
    };
    expect(isCloudRunWorkerFresh(metadata, now)).toBe(false);
    expect(isAnalyzeStale(metadata, undefined, now)).toBe(true);
  });

  it("uses the 90 minute window for Railway analyze runs", () => {
    const fresh = { startedAt: new Date(now - 60 * 60 * 1000).toISOString() };
    const old = { startedAt: new Date(now - 91 * 60 * 1000).toISOString() };
    expect(isAnalyzeStale({}, fresh, now)).toBe(false);
    expect(isAnalyzeStale({}, old, now)).toBe(true);
  });
});
