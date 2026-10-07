import {
  DEFAULT_DAILY_SCAN_CAP,
  MAX_TRANSCRIPT_ATTEMPTS,
  TRANSCRIPT_BACKOFF_BASE_MS,
  TRANSCRIPT_BACKOFF_CAP_MS,
  WEBSITE_NOT_READY_BACKOFF_MS,
  WEBSITE_NOT_READY_GAVE_UP_ERROR,
  WEBSITE_NOT_READY_MAX_MS,
  WEBSITE_OVERLAP_BACKOFF_MS,
  type TranscriptScanStatus,
} from "./constants";

/**
 * Off unless the variable is an explicit on-value (`1`, `true`, `yes`, `on`).
 * Unset or blank does not scan. An admin Re-scan still runs.
 */
export function isLiveTranscriptionEnabled(
  raw: string | undefined = process.env.LIVE_TRANSCRIPTION_ENABLED
): boolean {
  if (raw == null) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/** Paid scans allowed per UTC day. Unset, blank, or invalid uses 10. */
export function liveTranscriptionDailyCap(
  raw: string | undefined = process.env.LIVE_TRANSCRIPTION_DAILY_CAP
): number {
  if (raw == null || raw.trim() === "") return DEFAULT_DAILY_SCAN_CAP;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DAILY_SCAN_CAP;
  return parsed;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function retryDelayMs(attempt: number): number {
  const n = Math.max(1, attempt);
  const delay = TRANSCRIPT_BACKOFF_BASE_MS * 2 ** (n - 1);
  return Math.min(TRANSCRIPT_BACKOFF_CAP_MS, delay);
}

export interface TranscriptDueRow {
  transcriptStatus: string | null;
  transcriptAttempts: number;
  transcriptNextAttemptAt: Date | null;
}

/**
 * Whether the cron should claim this archived row. A processing row is due
 * only after its lease (`transcriptNextAttemptAt`) has passed, and only
 * while attempts remain. A failed row with no next attempt is stopped
 * (attempt cap or the 14-day website wait). Download failures stop after
 * {@link MAX_TRANSCRIPT_ATTEMPTS}.
 */
export function isTranscriptDue(row: TranscriptDueRow, now: Date): boolean {
  const status = row.transcriptStatus;
  if (
    status !== "pending" &&
    status !== "failed" &&
    status !== "website_not_ready" &&
    status !== "processing"
  ) {
    return false;
  }
  if (
    (status === "failed" || status === "processing") &&
    row.transcriptAttempts >= MAX_TRANSCRIPT_ATTEMPTS
  ) {
    return false;
  }
  if (status === "failed" && !row.transcriptNextAttemptAt) {
    return false;
  }
  if (
    row.transcriptNextAttemptAt &&
    row.transcriptNextAttemptAt.getTime() > now.getTime()
  ) {
    return false;
  }
  return true;
}

export interface TranscriptWritePlan {
  transcriptStatus: TranscriptScanStatus;
  transcriptError: string | null;
  transcriptAttempts: number;
  transcriptNextAttemptAt: Date | null;
  transcriptScannedAt: Date | null;
  transcriptClaimToken: null;
  transcriptNotReadySince: Date | null;
}

/**
 * HTTP 404 from the website route. The transcript and marks stay put.
 * Attempts are not incremented, so waiting on the website cannot exhaust
 * the download retry budget. After 14 days the row is failed and an admin
 * can Re-scan.
 */
export function planWebsiteNotReady(
  now: Date,
  attempts: number,
  notReadySince: Date | null = null
): TranscriptWritePlan {
  const since = notReadySince ?? now;
  if (now.getTime() - since.getTime() >= WEBSITE_NOT_READY_MAX_MS) {
    return {
      transcriptStatus: "failed",
      transcriptError: WEBSITE_NOT_READY_GAVE_UP_ERROR,
      transcriptAttempts: attempts,
      transcriptNextAttemptAt: null,
      transcriptScannedAt: null,
      transcriptClaimToken: null,
      transcriptNotReadySince: since,
    };
  }
  return {
    transcriptStatus: "website_not_ready",
    transcriptError: "Website route is not ready (HTTP 404). Will retry.",
    transcriptAttempts: attempts,
    transcriptNextAttemptAt: new Date(now.getTime() + WEBSITE_NOT_READY_BACKOFF_MS),
    transcriptScannedAt: null,
    transcriptClaimToken: null,
    transcriptNotReadySince: since,
  };
}

/**
 * 409 from the website: another POST for this live id holds a short lock.
 * Retry after a couple of minutes. This does not burn an extra attempt;
 * the claim already counted this try.
 */
export function planOverlapRetry(
  now: Date,
  attempts: number,
  message: string
): TranscriptWritePlan {
  const gaveUp = attempts >= MAX_TRANSCRIPT_ATTEMPTS;
  return {
    transcriptStatus: gaveUp ? "failed" : "pending",
    transcriptError: gaveUp
      ? `${message} (stopped after ${attempts} attempts)`
      : message,
    transcriptAttempts: attempts,
    transcriptNextAttemptAt: gaveUp
      ? null
      : new Date(now.getTime() + WEBSITE_OVERLAP_BACKOFF_MS),
    transcriptScannedAt: null,
    transcriptClaimToken: null,
    transcriptNotReadySince: null,
  };
}

/**
 * 401/403 or missing WordPress app credentials. Same class as
 * {@link WpConfigError}: the cron must not keep posting.
 * An admin Re-scan can try again after the credentials are fixed.
 */
export function planConfigError(
  attempts: number,
  message: string
): TranscriptWritePlan {
  return {
    transcriptStatus: "config_error",
    transcriptError: message,
    transcriptAttempts: attempts,
    transcriptNextAttemptAt: null,
    transcriptScannedAt: null,
    transcriptClaimToken: null,
    transcriptNotReadySince: null,
  };
}

/**
 * 400 or 422 from the website. The payload was rejected. Do not retry.
 * An admin Re-scan can try again after the portal payload is fixed.
 */
export function planContractError(
  attempts: number,
  message: string
): TranscriptWritePlan {
  return {
    transcriptStatus: "contract_error",
    transcriptError: message,
    transcriptAttempts: attempts,
    transcriptNextAttemptAt: null,
    transcriptScannedAt: null,
    transcriptClaimToken: null,
    transcriptNotReadySince: null,
  };
}

/**
 * `attemptsAfter` is the value already stored by the claim. The failure
 * path must not increment again.
 */
export function planTranscriptFailure(
  now: Date,
  attemptsAfter: number,
  message: string
): TranscriptWritePlan {
  const gaveUp = attemptsAfter >= MAX_TRANSCRIPT_ATTEMPTS;
  return {
    transcriptStatus: "failed",
    transcriptError: gaveUp
      ? `${message} (stopped after ${attemptsAfter} attempts)`
      : message,
    transcriptAttempts: attemptsAfter,
    transcriptNextAttemptAt: gaveUp
      ? null
      : new Date(now.getTime() + retryDelayMs(attemptsAfter)),
    transcriptScannedAt: null,
    transcriptClaimToken: null,
    transcriptNotReadySince: null,
  };
}
