import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockFail = vi.fn();

vi.mock("@/lib/jobs/stale-job-watchdog", () => ({
  failStaleProcessingJobs: (...args: unknown[]) => mockFail(...args),
}));

import { GET, POST } from "@/app/api/cron/sweep-stale-jobs/route";

beforeEach(() => {
  mockFail.mockReset();
  process.env.CRON_SECRET = "cron-secret";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function request(authorization?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/sweep-stale-jobs", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

describe("POST /api/cron/sweep-stale-jobs", () => {
  it("rejects a missing or wrong bearer token", async () => {
    const missing = await POST(request());
    expect(missing.status).toBe(401);
    const wrong = await POST(request("Bearer other"));
    expect(wrong.status).toBe(401);
    expect(mockFail).not.toHaveBeenCalled();
  });

  it("returns 500 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const response = await POST(request("Bearer cron-secret"));
    expect(response.status).toBe(500);
    expect(mockFail).not.toHaveBeenCalled();
  });

  it("runs the sweep for an authorized caller", async () => {
    mockFail.mockResolvedValue({ checked: 2, failedIds: ["job-stale"] });
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked: 2,
      failedIds: ["job-stale"],
    });
    expect(mockFail).toHaveBeenCalledTimes(1);
  });
});
