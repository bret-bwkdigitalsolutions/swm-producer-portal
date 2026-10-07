import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/job-queue";
import {
  LIVE_SCAN_LOCK_CLASS,
  LIVE_SCAN_LOCK_KEY,
  MAX_TRANSCRIPT_ATTEMPTS,
  TRANSCRIPT_STALE_MS,
  WEBSITE_NOT_READY_GAVE_UP_ERROR,
  WEBSITE_NOT_READY_MAX_MS,
} from "./constants";
import {
  isLiveTranscriptionEnabled,
  isTranscriptDue,
  liveTranscriptionDailyCap,
  startOfUtcDay,
} from "./retry";
import { runLiveTranscription } from "./worker";

export interface ClaimResult {
  claimed: boolean;
  token: string | null;
  reason: "claimed" | "in_flight" | "daily_cap" | "not_eligible";
}

let claimTail: Promise<void> = Promise.resolve();

function withClaimLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = claimTail.then(fn, fn);
  claimTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function leaseUntil(now: Date): Date {
  return new Date(now.getTime() + TRANSCRIPT_STALE_MS);
}

function dueWindow(now: Date) {
  return {
    OR: [
      { transcriptNextAttemptAt: null },
      { transcriptNextAttemptAt: { lte: now } },
    ],
  };
}

type ClaimTx = Prisma.TransactionClient;

async function hasUnexpiredLease(
  tx: Pick<ClaimTx, "liveRecording"> | typeof db,
  now: Date
): Promise<boolean> {
  const busy = await tx.liveRecording.findFirst({
    where: {
      transcriptStatus: "processing",
      transcriptNextAttemptAt: { gt: now },
    },
    select: { id: true },
  });
  return busy != null;
}

/** Every paid claim since UTC midnight, including retries of the same row. */
async function dailyCapReached(tx: ClaimTx, now: Date): Promise<boolean> {
  const cap = liveTranscriptionDailyCap();
  const used = await tx.liveScanPaidClaim.count({
    where: { claimedAt: { gte: startOfUtcDay(now) } },
  });
  return used >= cap;
}

async function takeAdvisoryLock(tx: ClaimTx): Promise<void> {
  await tx.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock($1::int, $2::int)",
    LIVE_SCAN_LOCK_CLASS,
    LIVE_SCAN_LOCK_KEY
  );
}

/**
 * Reset one archived row only when no scan holds an unexpired lease.
 * The NOT EXISTS check and the write are one statement, so a lease that
 * appears after a separate read cannot slip through.
 */
async function resetForRescan(tx: ClaimTx, id: string, now: Date): Promise<number> {
  return tx.$executeRawUnsafe(
    `UPDATE live_recordings
     SET "transcriptStatus" = 'pending',
         "transcriptAttempts" = 0,
         "transcriptNextAttemptAt" = NULL,
         "transcriptError" = NULL,
         "transcriptScannedAt" = NULL,
         "transcriptClaimToken" = NULL,
         "transcriptNotReadySince" = NULL,
         "updatedAt" = NOW()
     WHERE id = $1
       AND state = 'archived'
       AND NOT EXISTS (
         SELECT 1 FROM live_recordings AS busy
         WHERE busy."transcriptStatus" = 'processing'
           AND busy."transcriptNextAttemptAt" > $2
       )`,
    id,
    now
  );
}

async function claimOn(
  tx: ClaimTx,
  id: string,
  now: Date,
  options?: { ignoreDailyCap?: boolean }
): Promise<ClaimResult> {
  await takeAdvisoryLock(tx);

  if (await hasUnexpiredLease(tx, now)) {
    return { claimed: false, token: null, reason: "in_flight" as const };
  }

  const existing = await tx.liveRecording.findUnique({
    where: { id },
    select: { transcriptVtt: true, transcriptStatus: true },
  });
  if (!existing) {
    return { claimed: false, token: null, reason: "not_eligible" as const };
  }

  const token = randomUUID();
  const leased = leaseUntil(now);

  if (existing.transcriptStatus === "website_not_ready") {
    const cutoff = new Date(now.getTime() - WEBSITE_NOT_READY_MAX_MS);
    const result = await tx.liveRecording.updateMany({
      where: {
        id,
        state: "archived",
        transcriptStatus: "website_not_ready",
        AND: [
          dueWindow(now),
          {
            OR: [
              { transcriptNotReadySince: null },
              { transcriptNotReadySince: { gt: cutoff } },
            ],
          },
        ],
      },
      data: {
        transcriptStatus: "processing",
        transcriptClaimToken: token,
        transcriptNextAttemptAt: leased,
        transcriptError: null,
      },
    });
    if (result.count === 1) {
      return { claimed: true, token, reason: "claimed" as const };
    }
    return { claimed: false, token: null, reason: "not_eligible" as const };
  }

  const expensive = existing.transcriptVtt == null;
  if (
    expensive &&
    !options?.ignoreDailyCap &&
    (await dailyCapReached(tx, now))
  ) {
    return { claimed: false, token: null, reason: "daily_cap" as const };
  }

  const result = await tx.liveRecording.updateMany({
    where: {
      id,
      state: "archived",
      transcriptAttempts: { lt: MAX_TRANSCRIPT_ATTEMPTS },
      AND: [
        {
          OR: [
            { transcriptStatus: "pending" },
            {
              transcriptStatus: "failed",
              transcriptNextAttemptAt: { lte: now },
            },
            { transcriptStatus: "processing" },
          ],
        },
        dueWindow(now),
        expensive ? { transcriptVtt: null } : { NOT: { transcriptVtt: null } },
      ],
    },
    data: {
      transcriptStatus: "processing",
      transcriptClaimToken: token,
      transcriptAttempts: { increment: 1 },
      transcriptNextAttemptAt: leased,
      transcriptError: null,
      ...(expensive ? { transcriptLastClaimedAt: now } : {}),
    },
  });
  if (result.count !== 1) {
    return { claimed: false, token: null, reason: "not_eligible" as const };
  }
  if (expensive) {
    await tx.liveScanPaidClaim.create({
      data: { liveRecordingId: id, claimedAt: now },
    });
  }
  return { claimed: true, token, reason: "claimed" as const };
}

async function claimUnlocked(
  id: string,
  now: Date,
  options?: { ignoreDailyCap?: boolean }
): Promise<ClaimResult> {
  return db.$transaction((tx) => claimOn(tx, id, now, options));
}

/**
 * Claim one archived row. The attempt counter goes up in the same update
 * as the lease, so an expired lease cannot be re-claimed forever. A claim
 * token is stored and required on every later worker write.
 * The lease check, the daily cap, and the claim run in one transaction
 * under pg_advisory_xact_lock, so two replicas cannot both start a scan.
 * The in-memory lock still serializes claims inside this process.
 * Skips the claim when any row still holds an unexpired lease.
 */
export function claimLiveTranscription(
  id: string,
  now: Date,
  options?: { ignoreDailyCap?: boolean }
): Promise<ClaimResult> {
  return withClaimLock(() => claimUnlocked(id, now, options));
}

function enqueue(
  id: string,
  token: string,
  options?: { adminRescan?: boolean }
): void {
  enqueueJob(`live-transcript:${id}`, () =>
    runLiveTranscription(id, token, options)
  );
}

async function expireWebsiteNotReady(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - WEBSITE_NOT_READY_MAX_MS);
  await db.liveRecording.updateMany({
    where: {
      transcriptStatus: "website_not_ready",
      transcriptNotReadySince: { lte: cutoff },
    },
    data: {
      transcriptStatus: "failed",
      transcriptError: WEBSITE_NOT_READY_GAVE_UP_ERROR,
      transcriptNextAttemptAt: null,
      transcriptClaimToken: null,
    },
  });
}

async function failExhaustedProcessing(now: Date): Promise<void> {
  await db.liveRecording.updateMany({
    where: {
      state: "archived",
      transcriptStatus: "processing",
      transcriptAttempts: { gte: MAX_TRANSCRIPT_ATTEMPTS },
      ...dueWindow(now),
    },
    data: {
      transcriptStatus: "failed",
      transcriptNextAttemptAt: null,
      transcriptClaimToken: null,
      transcriptError: `Stopped after ${MAX_TRANSCRIPT_ATTEMPTS} attempts. The previous scan did not finish. Re-scan to try again.`,
    },
  });
}

/**
 * Queue at most one due scan. Historical rows with a null status are left
 * alone; archive sets `pending`, and an admin re-scan does too.
 * No-ops when LIVE_TRANSCRIPTION_ENABLED is off.
 * Due rows are filtered in SQL (`nextAttemptAt` null or already passed,
 * nulls first) so a future retry cannot starve a new recording.
 */
export async function queueDueLiveTranscriptions(now = new Date()): Promise<{
  queued: string[];
  disabled: boolean;
}> {
  await expireWebsiteNotReady(now);
  await failExhaustedProcessing(now);

  if (!isLiveTranscriptionEnabled()) {
    return { queued: [], disabled: true };
  }

  const rows = await db.liveRecording.findMany({
    where: {
      state: "archived",
      AND: [
        {
          OR: [
            { transcriptStatus: "pending" },
            { transcriptStatus: "website_not_ready" },
            {
              transcriptStatus: "failed",
              transcriptAttempts: { lt: MAX_TRANSCRIPT_ATTEMPTS },
              transcriptNextAttemptAt: { lte: now },
            },
            {
              transcriptStatus: "processing",
              transcriptAttempts: { lt: MAX_TRANSCRIPT_ATTEMPTS },
            },
          ],
        },
        dueWindow(now),
      ],
    },
    orderBy: [
      { transcriptNextAttemptAt: { sort: "asc", nulls: "first" } },
      { archivedAt: "asc" },
    ],
    take: 25,
  });

  for (const row of rows) {
    if (!isTranscriptDue(row, now)) continue;
    const claim = await claimLiveTranscription(row.id, now);
    if (claim.reason === "in_flight") break;
    if (!claim.claimed || !claim.token) continue;
    enqueue(row.id, claim.token);
    return { queued: [row.id], disabled: false };
  }
  return { queued: [], disabled: false };
}

/**
 * Admin re-scan. Reuses a stored transcript (no second Deepgram call) and
 * runs even when the env flag is off, so one recording can be tried on
 * staging without turning the cron loose. Also bypasses the daily cap.
 */
export async function requestLiveRescan(
  id: string
): Promise<{ ok: boolean; message: string }> {
  return withClaimLock(async () => {
    const row = await db.liveRecording.findUnique({ where: { id } });
    if (!row) return { ok: false, message: "Recording not found." };
    if (row.state !== "archived") {
      return {
        ok: false,
        message: "Marks are scanned after the recording is archived.",
      };
    }
    const now = new Date();
    return db.$transaction(async (tx) => {
      await takeAdvisoryLock(tx);
      const reset = await resetForRescan(tx, id, now);
      if (reset !== 1) {
        if (await hasUnexpiredLease(tx, now)) {
          return { ok: false, message: "A scan is already running." };
        }
        return { ok: false, message: "Could not queue a re-scan." };
      }

      const claim = await claimOn(tx, id, now, { ignoreDailyCap: true });
      if (claim.claimed && claim.token) {
        enqueue(id, claim.token, { adminRescan: true });
        return {
          ok: true,
          message:
            "Re-scan queued. The saved transcript is reused when one exists.",
        };
      }
      if (claim.reason === "in_flight") {
        return { ok: false, message: "A scan is already running." };
      }
      return { ok: false, message: "Could not queue a re-scan." };
    });
  });
}
