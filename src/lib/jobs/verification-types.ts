/**
 * Shared (client-safe) types and pure helpers for post-distribution
 * verification. No server-only imports here — the job detail view and the
 * distribution list import this module too.
 */

export type Severity = "critical" | "warning";

export type TierNumber = 1 | 2 | 3 | 4 | 5;

export interface VerificationIssue {
  platform: string;
  field: string;
  expected: string;
  actual: string;
  /** Missing on results written before severities existed — see issueSeverity(). */
  severity?: Severity;
  /** True when the failure looked transient (timeout, 429, 5xx) after retries. */
  transient?: boolean;
}

export interface PlatformTierResult {
  platform: string;
  passed: boolean;
  issues: VerificationIssue[];
}

export interface TierResult {
  tier: TierNumber;
  ranAt: string;
  platforms: PlatformTierResult[];
}

/**
 * Something that went wrong *during* distribution but did not fail the
 * platform outright (network cross-post, playlist add, thumbnail upload,
 * thumbnail backfill). Previously these were only console.error'd.
 */
export interface DistributionIssue {
  source: string; // e.g. "network_transistor", "youtube_playlist", "thumbnail_backfill"
  platform: string;
  severity: Severity;
  message: string;
  at: string;
}

export type VerdictStatus = "pending" | "passed" | "warnings" | "failed";

export interface VerificationVerdict {
  status: VerdictStatus;
  critical: Array<VerificationIssue | DistributionIssue>;
  warnings: Array<VerificationIssue | DistributionIssue>;
  /** Which tier the verification issues were taken from (null if none ran). */
  basedOnTier: TierNumber | null;
}

/**
 * Tier schedule. Tiers 1–4 each run ONLY their own checks (no accumulation);
 * tier 5 is a single final pass that runs every check once more and decides
 * whether to alert.
 */
export const TIER_INFO: Record<TierNumber, { label: string; whenLabel: string; delayMs: number }> = {
  1: { label: "Smoke", whenLabel: "30 sec", delayMs: 30_000 },        // does the resource exist?
  2: { label: "Metadata", whenLabel: "2 min", delayMs: 2 * 60_000 },   // title, artwork
  3: { label: "Processing", whenLabel: "10 min", delayMs: 10 * 60_000 }, // processed/published, audio reachable
  4: { label: "Public URL", whenLabel: "30 min", delayMs: 30 * 60_000 }, // public URL serving
  5: { label: "Final", whenLabel: "60 min", delayMs: 60 * 60_000 },      // full re-check → verdict + alert
};

export const ALL_TIERS: TierNumber[] = [1, 2, 3, 4, 5];

/** Fields that were cosmetic before severities existed (legacy results). */
const LEGACY_WARNING_FIELDS = new Set(["thumbnail"]);

export function issueSeverity(issue: { severity?: Severity; field?: string }): Severity {
  if (issue.severity) return issue.severity;
  return issue.field && LEGACY_WARNING_FIELDS.has(issue.field) ? "warning" : "critical";
}

/**
 * Compute the overall verdict for a job.
 *
 * - New jobs (schedule version 2): final once tier 5 has run; the verdict uses
 *   tier 5's results only (the definitive re-check).
 * - Legacy jobs (pre-v2 schedule, tiers were cumulative): final once tier 4
 *   has run; tier 4 already contained every check.
 * - Before the final tier runs, status is "pending" and the issues reflect the
 *   latest interim results so the UI can still show them.
 */
export function computeVerdict(
  verifications: TierResult[] | null | undefined,
  distributionIssues: DistributionIssue[] | null | undefined,
  scheduleVersion?: number
): VerificationVerdict {
  const results = Array.isArray(verifications) ? verifications : [];
  const issues = Array.isArray(distributionIssues) ? distributionIssues : [];
  const finalTier: TierNumber = (scheduleVersion ?? 1) >= 2 ? 5 : 4;

  const byTier = new Map<number, TierResult>();
  for (const r of results) byTier.set(r.tier, r);

  let basis: TierResult | undefined = byTier.get(finalTier);
  const isFinal = !!basis || (finalTier === 4 && byTier.has(5));
  if (!basis && finalTier === 4) basis = byTier.get(5);

  let verificationIssues: VerificationIssue[];
  if (basis) {
    verificationIssues = basis.platforms.flatMap((p) => p.issues);
  } else {
    // Interim: union of the latest issue per platform+field across tiers run so far.
    const latest = new Map<string, VerificationIssue>();
    for (const r of [...results].sort((a, b) => a.tier - b.tier)) {
      for (const p of r.platforms) {
        for (const i of p.issues) latest.set(`${i.platform}:${i.field}`, i);
      }
    }
    verificationIssues = [...latest.values()];
  }

  const all: Array<VerificationIssue | DistributionIssue> = [...verificationIssues, ...issues];
  const critical = all.filter((i) => issueSeverity(i as VerificationIssue) === "critical");
  const warnings = all.filter((i) => issueSeverity(i as VerificationIssue) === "warning");

  const status: VerdictStatus = !isFinal
    ? "pending"
    : critical.length > 0
      ? "failed"
      : warnings.length > 0
        ? "warnings"
        : "passed";

  return { status, critical, warnings, basedOnTier: basis?.tier ?? null };
}

/** One-line description of an issue for UI lists and emails. */
export function describeIssue(issue: VerificationIssue | DistributionIssue): string {
  if ("message" in issue) return issue.message;
  return `${issue.field}: expected "${issue.expected}", got "${issue.actual}"`;
}
