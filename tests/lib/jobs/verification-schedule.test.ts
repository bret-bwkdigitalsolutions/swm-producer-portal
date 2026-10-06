import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockJobFindUnique = vi.fn();
const mockJobFindMany = vi.fn();
const mockJobUpdate = vi.fn();
const mockQueryRaw = vi.fn();
vi.mock("@/lib/db", () => {
  const dbMock: Record<string, unknown> = {
    distributionJob: {
      findUnique: (...a: unknown[]) => mockJobFindUnique(...a),
      findMany: (...a: unknown[]) => mockJobFindMany(...a),
      update: (...a: unknown[]) => mockJobUpdate(...a),
    },
    $queryRaw: (...a: unknown[]) => mockQueryRaw(...a),
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(dbMock),
  };
  return { db: dbMock };
});

const mockSendVerificationFailure = vi.fn();
vi.mock("@/lib/notifications", () => ({
  sendVerificationFailureNotification: (...a: unknown[]) => mockSendVerificationFailure(...a),
}));

const mockRunTier = vi.fn();
vi.mock("@/lib/jobs/verify-distribution", () => ({
  runVerificationTier: (...a: unknown[]) => mockRunTier(...a),
}));

vi.mock("@/lib/wordpress/client", () => ({
  getShow: vi.fn().mockResolvedValue({ title: { rendered: "The Show" } }),
}));

import {
  finalizeVerification,
  resumeVerificationSchedules,
  runScheduledTier,
  scheduleVerificationTiers,
  type VerificationSchedule,
} from "@/lib/jobs/verification-schedule";
import type { TierResult, VerificationIssue } from "@/lib/jobs/verification-types";

const schedule: VerificationSchedule = {
  scheduledAt: new Date().toISOString(),
  wpShowId: 42,
  title: "Episode 1",
  isLiveRecording: false,
  isPremium: false,
  isDraft: false,
  version: 2,
  done: false,
};

function tier5(issues: VerificationIssue[]): TierResult {
  return {
    tier: 5,
    ranAt: new Date().toISOString(),
    platforms: [{ platform: "website", passed: !issues.some((i) => i.severity === "critical"), issues }],
  };
}

let persisted: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  mockSendVerificationFailure.mockResolvedValue("sent");
  persisted = {};
  mockQueryRaw.mockImplementation(async () => [{ metadata: persisted }]);
  mockJobUpdate.mockImplementation(async ({ data }: { data: { metadata: Record<string, unknown> } }) => {
    persisted = data.metadata;
    return {};
  });
  mockJobFindUnique.mockImplementation(async () => ({ metadata: persisted }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("finalizeVerification", () => {
  it("sends one ❌ email when a critical issue persists at the final check", async () => {
    const critical: VerificationIssue = {
      platform: "website", field: "status", expected: "publish", actual: "trash", severity: "critical",
    };
    const warning: VerificationIssue = {
      platform: "website", field: "thumbnail", expected: "featured image", actual: "none", severity: "warning",
    };
    persisted = { verifications: [tier5([critical, warning])] };

    await finalizeVerification("job-1", schedule);
    expect(mockSendVerificationFailure).toHaveBeenCalledTimes(1);
    expect(mockSendVerificationFailure).toHaveBeenCalledWith(
      expect.objectContaining({ showName: "The Show", issues: [critical], warnings: [warning] })
    );
    expect(persisted.verificationVerdict).toMatchObject({ status: "failed", criticalCount: 1, warningCount: 1 });
    expect((persisted.verificationSchedule as VerificationSchedule).done).toBe(true);
    expect((persisted.verificationVerdict as { notifiedAt?: string }).notifiedAt).toBeTruthy();

    // Never twice for the same job.
    await finalizeVerification("job-1", schedule);
    expect(mockSendVerificationFailure).toHaveBeenCalledTimes(1);
  });

  it("does not email when there are only warnings", async () => {
    persisted = {
      verifications: [
        tier5([{ platform: "transistor", field: "thumbnail", expected: "x", actual: "none", severity: "warning" }]),
      ],
    };
    await finalizeVerification("job-1", schedule);
    expect(mockSendVerificationFailure).not.toHaveBeenCalled();
    expect(persisted.verificationVerdict).toMatchObject({ status: "warnings" });
  });

  it("emails for a critical distribution issue even when every platform check passed", async () => {
    persisted = {
      verifications: [tier5([])],
      distributionIssues: [
        { source: "network_transistor", platform: "transistor_network", severity: "critical", message: "cross-post failed", at: "" },
      ],
    };
    await finalizeVerification("job-1", schedule);
    expect(mockSendVerificationFailure).toHaveBeenCalledTimes(1);
  });

  it("leaves the schedule open when the alert email fails so a restart can retry", async () => {
    mockSendVerificationFailure.mockResolvedValue("failed");
    const critical: VerificationIssue = {
      platform: "website", field: "status", expected: "publish", actual: "trash", severity: "critical",
    };
    persisted = { verifications: [tier5([critical])] };

    await finalizeVerification("job-1", schedule);
    expect(mockSendVerificationFailure).toHaveBeenCalledTimes(1);
    expect((persisted.verificationSchedule as VerificationSchedule).done).toBe(false);
    expect((persisted.verificationVerdict as { notifiedAt?: string }).notifiedAt).toBeUndefined();
    expect(persisted.verificationVerdict).toMatchObject({ status: "failed", notifyError: "alert email failed" });

    mockSendVerificationFailure.mockResolvedValue("sent");
    await finalizeVerification("job-1", schedule);
    expect(mockSendVerificationFailure).toHaveBeenCalledTimes(2);
    expect((persisted.verificationSchedule as VerificationSchedule).done).toBe(true);
    expect((persisted.verificationVerdict as { notifiedAt?: string }).notifiedAt).toBeTruthy();
  });
});

describe("runScheduledTier", () => {
  it("re-checks once more before alerting when the final check only hit transient errors", async () => {
    vi.useFakeTimers();
    const transient: VerificationIssue = {
      platform: "website", field: "api_check", expected: "accessible", actual: "API 503", severity: "critical", transient: true,
    };
    mockRunTier.mockImplementation(async () => {
      const r = tier5([transient]);
      persisted = { ...persisted, verifications: [r] };
      return r;
    });

    await runScheduledTier("job-1", schedule, 5);
    expect(mockSendVerificationFailure).not.toHaveBeenCalled();
    expect(persisted.verificationVerdict).toBeUndefined();
    expect((persisted.verificationSchedule as VerificationSchedule).pendingTransientRecheck).toBe(true);

    // Recheck still failing → alert.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mockRunTier).toHaveBeenCalledTimes(2);
    expect(mockSendVerificationFailure).toHaveBeenCalledTimes(1);
  });

  it("interim tiers never finalize or email", async () => {
    mockRunTier.mockResolvedValue({
      tier: 2,
      ranAt: "",
      platforms: [{ platform: "website", passed: false, issues: [{ platform: "website", field: "title", expected: "a", actual: "b", severity: "critical" }] }],
    });
    await runScheduledTier("job-1", schedule, 2);
    expect(mockSendVerificationFailure).not.toHaveBeenCalled();
    expect(persisted.verificationVerdict).toBeUndefined();
  });
});

describe("resumeVerificationSchedules", () => {
  it("resumes a pending transient re-check instead of emailing the first result", async () => {
    vi.useFakeTimers();
    const transient: VerificationIssue = {
      platform: "website", field: "api_check", expected: "accessible", actual: "API 503", severity: "critical", transient: true,
    };
    const ranAt = new Date().toISOString();
    persisted = {
      verifications: [
        ...([1, 2, 3, 4] as const).map((tier) => ({ tier, ranAt, platforms: [] })),
        tier5([transient]),
      ],
      verificationSchedule: { ...schedule, pendingTransientRecheck: true, done: false },
    };
    mockJobFindMany.mockImplementation(async () => [{ id: "job-1", metadata: persisted }]);
    mockRunTier.mockImplementation(async () => {
      const clean = tier5([]);
      persisted = { ...persisted, verifications: [clean] };
      return clean;
    });

    await resumeVerificationSchedules();
    expect(mockSendVerificationFailure).not.toHaveBeenCalled();
    expect(mockRunTier).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mockRunTier).toHaveBeenCalledTimes(1);
    expect(mockRunTier).toHaveBeenCalledWith(5, "job-1", 42, "Episode 1", expect.any(Object));
    expect(mockSendVerificationFailure).not.toHaveBeenCalled();
    expect(persisted.verificationVerdict).toMatchObject({ status: "passed" });
    expect((persisted.verificationSchedule as VerificationSchedule).done).toBe(true);
    expect((persisted.verificationSchedule as VerificationSchedule).pendingTransientRecheck).toBeUndefined();
  });
});

describe("scheduleVerificationTiers", () => {
  it("persists a v2 schedule and runs five tiers ending at 60 minutes", async () => {
    vi.useFakeTimers();
    mockRunTier.mockImplementation(async (tier: number) => ({ tier, ranAt: "", platforms: [] }));
    await scheduleVerificationTiers("job-1", {
      wpShowId: 42, title: "Episode 1", isLiveRecording: false, isPremium: false, isDraft: true,
    });
    expect(persisted.verificationSchedule).toMatchObject({ version: 2, isDraft: true, done: false });

    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(mockRunTier.mock.calls.map((c) => c[0])).toEqual([1, 2, 3, 4]);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(mockRunTier.mock.calls.map((c) => c[0])).toEqual([1, 2, 3, 4, 5]);
    expect(mockRunTier).toHaveBeenLastCalledWith(5, "job-1", 42, "Episode 1", {
      isLiveRecording: false, isPremium: false, isDraft: true,
    });
  });
});
