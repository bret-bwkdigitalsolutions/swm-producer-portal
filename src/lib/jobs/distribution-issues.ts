import { appendJobMetadataItem } from "./job-metadata";
import type { DistributionIssue, Severity } from "./verification-types";

/**
 * Record a non-fatal distribution problem on the job (metadata.distributionIssues)
 * and log it. Never throws — recording must not break the pipeline.
 *
 * These used to be console.error-only, so a failed network cross-post or
 * playlist add was invisible in the portal. They now show in the job's
 * Verification panel and feed the final verdict (critical ones alert).
 */
export async function recordDistributionIssue(
  jobId: string,
  issue: { source: string; platform: string; severity: Severity; message: string }
): Promise<void> {
  const entry: DistributionIssue = { ...issue, at: new Date().toISOString() };
  const log = issue.severity === "critical" ? console.error : console.warn;
  log(`[distribution-issue] job ${jobId} ${issue.severity} ${issue.source}/${issue.platform}: ${issue.message}`);
  try {
    await appendJobMetadataItem(jobId, "distributionIssues", entry);
  } catch (err) {
    console.error(`[distribution-issue] could not record issue for job ${jobId}:`, err);
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
