import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_SCAN_LOCK_CLASS,
  LIVE_SCAN_LOCK_KEY,
  MAX_TRANSCRIPT_ATTEMPTS,
} from "@/lib/live-marks/constants";
import { startOfUtcDay } from "@/lib/live-marks/retry";

const updateMany = vi.hoisted(() => vi.fn());
const findFirst = vi.hoisted(() => vi.fn());
const findUnique = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
const count = vi.hoisted(() => vi.fn());
const executeRawUnsafe = vi.hoisted(() => vi.fn());
const paidCount = vi.hoisted(() => vi.fn());
const paidCreate = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());

function transactionClient() {
  return {
    $executeRawUnsafe: executeRawUnsafe,
    liveRecording: {
      updateMany,
      findFirst,
      findUnique,
      findMany,
      count,
      update: vi.fn(),
    },
    liveScanPaidClaim: { count: paidCount, create: paidCreate },
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: transaction,
    liveRecording: {
      updateMany,
      findFirst,
      findUnique,
      findMany,
      count,
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/jobs/job-queue", () => ({ enqueueJob: vi.fn() }));
vi.mock("@/lib/live-marks/worker", () => ({
  runLiveTranscription: vi.fn(),
}));

import { enqueueJob } from "@/lib/jobs/job-queue";
import {
  claimLiveTranscription,
  queueDueLiveTranscriptions,
  requestLiveRescan,
} from "@/lib/live-marks/queue";
import { writeOwnedScan } from "@/lib/live-marks/lease";
import { runLiveTranscription } from "@/lib/live-marks/worker";

const now = new Date("2026-10-07T18:00:00.000Z");

beforeEach(() => {
  updateMany.mockReset();
  findFirst.mockReset();
  findUnique.mockReset();
  findMany.mockReset();
  count.mockReset();
  executeRawUnsafe.mockReset();
  paidCount.mockReset();
  paidCreate.mockReset();
  findFirst.mockResolvedValue(null);
  findUnique.mockResolvedValue({
    transcriptVtt: null,
    transcriptStatus: "pending",
  });
  count.mockResolvedValue(0);
  paidCount.mockResolvedValue(0);
  paidCreate.mockResolvedValue({ id: "claim-1" });
  executeRawUnsafe.mockResolvedValue(0);
  updateMany.mockResolvedValue({ count: 1 });
  transaction.mockReset();
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(transactionClient())
  );
  vi.mocked(enqueueJob).mockReset();
  process.env.LIVE_TRANSCRIPTION_ENABLED = "true";
  delete process.env.LIVE_TRANSCRIPTION_DAILY_CAP;
});

describe("claimLiveTranscription", () => {
  it("stores a claim token and increments attempts in the same update", async () => {
    const result = await claimLiveTranscription("rec-1", now);

    expect(result.claimed).toBe(true);
    expect(result.token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock($1::int, $2::int)",
      LIVE_SCAN_LOCK_CLASS,
      LIVE_SCAN_LOCK_KEY
    );
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(paidCreate).toHaveBeenCalledWith({
      data: { liveRecordingId: "rec-1", claimedAt: now },
    });
    const write = updateMany.mock.calls[0][0];
    expect(write.data.transcriptAttempts).toEqual({ increment: 1 });
    expect(write.data.transcriptClaimToken).toBe(result.token);
    expect(write.data.transcriptStatus).toBe("processing");
    expect(write.where.transcriptAttempts).toEqual({
      lt: MAX_TRANSCRIPT_ATTEMPTS,
    });
    expect(write.where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ transcriptStatus: "processing" }),
          ]),
        }),
        expect.objectContaining({
          OR: expect.arrayContaining([
            { transcriptNextAttemptAt: null },
            { transcriptNextAttemptAt: { lte: now } },
          ]),
        }),
      ])
    );
  });

  it("increments again on an expired lease and stops when the cap matches nothing", async () => {
    findUnique.mockResolvedValue({
      transcriptVtt: null,
      transcriptStatus: "processing",
    });
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const first = await claimLiveTranscription("rec-1", now);
    expect(first.claimed).toBe(true);
    expect(updateMany.mock.calls[0][0].data.transcriptAttempts).toEqual({
      increment: 1,
    });

    const later = new Date(now.getTime() + 91 * 60 * 1000);
    const second = await claimLiveTranscription("rec-1", later);
    expect(second).toEqual({
      claimed: false,
      token: null,
      reason: "not_eligible",
    });
    const retry = updateMany.mock.calls[1][0];
    expect(retry.data.transcriptAttempts).toEqual({ increment: 1 });
    expect(retry.where.transcriptAttempts).toEqual({
      lt: MAX_TRANSCRIPT_ATTEMPTS,
    });
    expect(retry.where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([
            { transcriptNextAttemptAt: { lte: later } },
          ]),
        }),
      ])
    );
  });

  it("does not claim while any row holds an unexpired lease", async () => {
    findFirst.mockResolvedValue({ id: "other-scan" });

    const result = await claimLiveTranscription("rec-1", now);

    expect(result).toEqual({
      claimed: false,
      token: null,
      reason: "in_flight",
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        transcriptStatus: "processing",
        transcriptNextAttemptAt: { gt: now },
      },
      select: { id: true },
    });
  });

  it("counts every paid claim since UTC midnight, including a retry of the same recording", async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await claimLiveTranscription("rec-1", now);
    const later = new Date(now.getTime() + 91 * 60 * 1000);
    await claimLiveTranscription("rec-1", later);

    expect(paidCreate).toHaveBeenCalledTimes(2);
    expect(paidCount).toHaveBeenCalledWith({
      where: { claimedAt: { gte: startOfUtcDay(now) } },
    });
    expect(paidCount.mock.calls[1][0]).toEqual({
      where: { claimedAt: { gte: startOfUtcDay(later) } },
    });
  });

  it("skips a new paid scan once the daily cap is full", async () => {
    paidCount.mockResolvedValue(10);

    const result = await claimLiveTranscription("rec-1", now);

    expect(result.reason).toBe("daily_cap");
    expect(updateMany).not.toHaveBeenCalled();
    expect(paidCreate).not.toHaveBeenCalled();
  });
});

describe("writeOwnedScan", () => {
  it("rejects a stale claim token", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });

    const wrote = await writeOwnedScan("rec-1", "stale-token", {
      transcriptStatus: "completed",
    });

    expect(wrote).toBe(false);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "rec-1",
        transcriptClaimToken: "stale-token",
        transcriptStatus: "processing",
      },
      data: { transcriptStatus: "completed" },
    });
  });

  it("writes when the token still owns the lease", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });

    const wrote = await writeOwnedScan("rec-1", "live-token", {
      transcriptError: null,
    });

    expect(wrote).toBe(true);
  });
});

describe("queueDueLiveTranscriptions", () => {
  it("selects only due rows, nulls first", async () => {
    findMany.mockResolvedValue([]);

    await queueDueLiveTranscriptions(now);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: "archived",
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { transcriptNextAttemptAt: null },
                { transcriptNextAttemptAt: { lte: now } },
              ]),
            }),
          ]),
        }),
        orderBy: [
          { transcriptNextAttemptAt: { sort: "asc", nulls: "first" } },
          { archivedAt: "asc" },
        ],
      })
    );
  });

  it("resets inside the advisory lock only when no lease is held", async () => {
    executeRawUnsafe.mockImplementation(async (sql: string) =>
      String(sql).includes("UPDATE live_recordings") ? 1 : 0
    );
    findUnique.mockResolvedValue({
      id: "rec-1",
      state: "archived",
      transcriptVtt: "WEBVTT",
      transcriptStatus: "completed",
    });

    const result = await requestLiveRescan("rec-1");

    expect(result.ok).toBe(true);
    const sqls = executeRawUnsafe.mock.calls.map((call) => String(call[0]));
    expect(sqls[0]).toContain("pg_advisory_xact_lock");
    expect(sqls[1]).toContain("UPDATE live_recordings");
    expect(sqls[1]).not.toContain("NOW()");
    expect(sqls[1]).toContain('"updatedAt" = $3');
    expect(executeRawUnsafe.mock.calls[1][3]).toBeInstanceOf(Date);
    expect(sqls[1]).toContain("NOT EXISTS");
    expect(sqls[1]).toContain(`busy."transcriptNextAttemptAt" > $2`);
    expect(updateMany).toHaveBeenCalled();
    expect(updateMany.mock.calls.at(-1)?.[0].data.liveScanAdminRescan).toBe(true);
    const queued = enqueueJob as unknown as ReturnType<typeof vi.fn>;
    const task = queued.mock.calls[0][1] as () => Promise<unknown>;
    await task();
    expect(runLiveTranscription).toHaveBeenCalledWith(
      "rec-1",
      expect.any(String),
      { adminRescan: true }
    );
  });

  it("does not reset a re-scan while a lease is held", async () => {
    executeRawUnsafe.mockResolvedValue(0);
    findFirst.mockResolvedValue({ id: "other-scan" });
    findUnique.mockResolvedValue({
      id: "rec-1",
      state: "archived",
      transcriptVtt: "WEBVTT",
      transcriptStatus: "completed",
    });

    const result = await requestLiveRescan("rec-1");

    expect(result).toEqual({
      ok: false,
      message: "A scan is already running.",
    });
    expect(updateMany).not.toHaveBeenCalled();
    const updateCall = executeRawUnsafe.mock.calls.find((call) =>
      String(call[0]).includes("UPDATE live_recordings")
    );
    expect(updateCall?.[0]).toContain("NOT EXISTS");
    expect(String(updateCall?.[0])).not.toContain("NOW()");
    expect(vi.mocked(enqueueJob)).not.toHaveBeenCalled();
  });

  it("enqueues a re-scan only after the transaction commits", async () => {
    executeRawUnsafe.mockImplementation(async (sql: string) =>
      String(sql).includes("UPDATE live_recordings") ? 1 : 0
    );
    findUnique.mockResolvedValue({
      id: "rec-1",
      state: "archived",
      transcriptVtt: "WEBVTT",
      transcriptStatus: "completed",
    });

    const events: string[] = [];
    let releaseCommit: () => void = () => {};
    const commitHold = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const result = await fn(transactionClient());
      events.push("callback-returned");
      await commitHold;
      events.push("commit");
      return result;
    });
    vi.mocked(enqueueJob).mockImplementation(() => {
      events.push("enqueue");
    });

    const pending = requestLiveRescan("rec-1");
    await vi.waitFor(() => {
      expect(events).toContain("callback-returned");
    });
    expect(events).not.toContain("enqueue");
    releaseCommit();
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(events).toEqual(["callback-returned", "commit", "enqueue"]);
  });

  it("does not claim when the flag is off", async () => {
    delete process.env.LIVE_TRANSCRIPTION_ENABLED;
    findMany.mockResolvedValue([
      {
        id: "rec-1",
        transcriptStatus: "pending",
        transcriptAttempts: 0,
        transcriptNextAttemptAt: null,
      },
    ]);

    const result = await queueDueLiveTranscriptions(now);

    expect(result).toEqual({ queued: [], disabled: true });
    expect(findMany).not.toHaveBeenCalled();
  });
});
