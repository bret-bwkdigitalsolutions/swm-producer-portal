import { db } from "@/lib/db";
import { sendVerificationFailureNotification } from "@/lib/notifications";
import { runVerificationTier } from "./verify-distribution";
import { mergeJobMetadata } from "./job-metadata";
import {
  ALL_TIERS,
  TIER_INFO,
  computeVerdict,
  type DistributionIssue,
  type TierNumber,
  type TierResult,
  type VerificationIssue,
} from "./verification-types";

/**
 * Post-distribution verification schedule.
 *
 * Tiers 1–4 (30s / 2m / 10m / 30m) each run only their own checks and are
 * informational — they never email. Tier 5 (60m) re-runs every check once and
 * produces the verdict:
 *   - critical issues → "failed" → one "❌ FAILED" email
 *   - only warnings   → "warnings" → shown in the portal, no email
 *   - nothing         → "passed"
 * If every critical issue at tier 5 looks transient (timeouts, 429/5xx), one
 * more re-check runs 10 minutes later before alerting.
 */

export const VERIFICATION_SCHEDULE_VERSION = 2;

export const verificationScheduleConfig = {
  delaysMs: Object.fromEntries(ALL_TIERS.map((t) => [t, TIER_INFO[t].delayMs])) as Record<TierNumber, number>,
  transientRecheckDelayMs: 10 * 60_000,
};

export type VerificationSchedule = {
  scheduledAt: string;
  wpShowId: number;
  title: string;
  isLiveRecording: boolean;
  isPremium: boolean;
  isDraft?: boolean;
  /** 2 = non-cumulative tiers + final tier 5. Absent on legacy schedules. */
  version?: number;
  done: boolean;
};

export async function scheduleVerificationTiers(
  jobId: string,
  params: { wpShowId: number; title: string; isLiveRecording: boolean; isPremium: boolean; isDraft: boolean }
): Promise<void> {
  const schedule: VerificationSchedule = {
    scheduledAt: new Date().toISOString(),
    ...params,
    version: VERIFICATION_SCHEDULE_VERSION,
    done: false,
  };

  // Persist before scheduling so a restart can resume pending tiers. A retry
  // re-schedules from scratch, so drop results from the previous run.
  await mergeJobMetadata(jobId, {
    verificationSchedule: schedule,
    verifications: [],
    verificationVerdict: undefined,
  }).catch((err) =>
    console.error(`[verify] could not persist verification schedule for job ${jobId}:`, err)
  );

  for (const tier of ALL_TIERS) {
    scheduleVerificationTier(jobId, schedule, tier, verificationScheduleConfig.delaysMs[tier]);
  }
}

function scheduleVerificationTier(
  jobId: string,
  schedule: VerificationSchedule,
  tier: TierNumber,
  delayMs: number,
  isTransientRecheck = false
) {
  setTimeout(() => {
    runScheduledTier(jobId, schedule, tier, isTransientRecheck).catch((err) => {
      console.error(`[verify] tier ${tier} failed for job ${jobId}:`, err);
    });
  }, delayMs).unref?.(); // don't keep the process alive past job completion
}

/** Exported for tests. */
export async function runScheduledTier(
  jobId: string,
  schedule: VerificationSchedule,
  tier: TierNumber,
  isTransientRecheck = false
): Promise<void> {
  const result = await runVerificationTier(tier, jobId, schedule.wpShowId, schedule.title, {
    isLiveRecording: schedule.isLiveRecording,
    isPremium: schedule.isPremium,
    isDraft: schedule.isDraft ?? false,
  });
  if (tier !== 5) return;

  const criticals = result.platforms.flatMap((p) => p.issues).filter((i) => i.severity === "critical");
  if (!isTransientRecheck && criticals.length > 0 && criticals.every((i) => i.transient)) {
    console.log(
      `[verify] job ${jobId}: final check hit only transient errors — re-checking in ${Math.round(verificationScheduleConfig.transientRecheckDelayMs / 60_000)} min before alerting`
    );
    scheduleVerificationTier(jobId, schedule, 5, verificationScheduleConfig.transientRecheckDelayMs, true);
    return;
  }

  await finalizeVerification(jobId, schedule);
}

/**
 * Compute and persist the verdict; email once if critical issues remain.
 * Marks the schedule done.
 */
export async function finalizeVerification(jobId: string, schedule: VerificationSchedule): Promise<void> {
  const job = await db.distributionJob.findUnique({ where: { id: jobId }, select: { metadata: true } });
  const meta = (job?.metadata as Record<string, unknown> | null) ?? {};
  const verdict = computeVerdict(
    meta.verifications as TierResult[] | undefined,
    meta.distributionIssues as DistributionIssue[] | undefined,
    schedule.version
  );
  const previous = meta.verificationVerdict as { notifiedAt?: string } | undefined;

  let notifiedAt = previous?.notifiedAt;
  if (verdict.status === "failed" && !notifiedAt) {
    let showName = `Show #${schedule.wpShowId}`;
    try {
      const { getShow } = await import("@/lib/wordpress/client");
      const show = await getShow(schedule.wpShowId);
      showName = show.title.rendered;
    } catch {
      // fall back to the ID
    }
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    await sendVerificationFailureNotification({
      jobTitle: schedule.title,
      showName,
      issues: verdict.critical as Array<VerificationIssue | DistributionIssue>,
      warnings: verdict.warnings as Array<VerificationIssue | DistributionIssue>,
      jobUrl: `${baseUrl}/dashboard/distribute/${jobId}`,
    });
    notifiedAt = new Date().toISOString();
  }

  console.log(
    `[verify] job ${jobId} verdict: ${verdict.status.toUpperCase()} (${verdict.critical.length} critical, ${verdict.warnings.length} warnings)${verdict.status === "failed" ? " — alert sent" : ""}`
  );

  await mergeJobMetadata(jobId, {
    verificationVerdict: {
      status: verdict.status,
      criticalCount: verdict.critical.length,
      warningCount: verdict.warnings.length,
      at: new Date().toISOString(),
      ...(notifiedAt ? { notifiedAt } : {}),
    },
    verificationSchedule: { ...schedule, done: true },
  });
}

/**
 * Called from instrumentation on server startup. Re-schedules verification
 * tiers that were pending when the previous container died (setTimeout-based
 * timers don't survive restarts). Overdue tiers run shortly after startup;
 * schedules older than 24h are abandoned.
 */
export async function resumeVerificationSchedules(): Promise<void> {
  const jobs = await db.distributionJob.findMany({
    where: { metadata: { path: ["verificationSchedule", "done"], equals: false } },
    select: { id: true, metadata: true },
  });

  for (const job of jobs) {
    const meta = (job.metadata as Record<string, unknown>) ?? {};
    const stored = meta.verificationSchedule as VerificationSchedule | undefined;
    if (!stored) continue;

    const elapsed = Date.now() - Date.parse(stored.scheduledAt);
    if (Number.isNaN(elapsed) || elapsed > 24 * 60 * 60 * 1000) {
      await mergeJobMetadata(job.id, { verificationSchedule: { ...stored, done: true } }).catch(() => {});
      continue;
    }

    // Legacy (pre-v2) schedules get the final tier too.
    const schedule: VerificationSchedule = { ...stored, version: VERIFICATION_SCHEDULE_VERSION };
    const ranTiers = new Set(
      ((meta.verifications as Array<{ tier: number }> | undefined) ?? []).map((v) => v.tier)
    );
    const remaining = ALL_TIERS.filter((t) => !ranTiers.has(t));
    if (remaining.length === 0) {
      await finalizeVerification(job.id, schedule).catch((err) =>
        console.error(`[verify] could not finalize job ${job.id}:`, err)
      );
      continue;
    }

    if (stored.version !== schedule.version) {
      await mergeJobMetadata(job.id, { verificationSchedule: schedule }).catch(() => {});
    }

    console.log(`[verify] Resuming verification for job ${job.id} — tiers ${remaining.join(", ")} pending`);
    for (const tier of remaining) {
      // Stagger overdue tiers slightly so they don't all fire at once.
      const delay = Math.max(verificationScheduleConfig.delaysMs[tier] - elapsed, tier * 10_000);
      scheduleVerificationTier(job.id, schedule, tier, delay);
    }
  }
}
