import {
  MAX_TRANSCRIPT_ATTEMPTS,
  TRANSCRIPT_BACKOFF_BASE_MS,
  TRANSCRIPT_BACKOFF_CAP_MS,
  WEBSITE_NOT_READY_BACKOFF_MS,
  type TranscriptScanStatus,
} from "./constants";

/**
 * Unset or blank enables the scan. `0`, `false`, `no`, and `off` disable it.
 * The default is on so a deploy scans new archives without an extra variable.
 */
export function isLiveTranscriptionEnabled(
  raw: string | undefined = process.env.LIVE_TRANSCRIPTION_ENABLED
): boolean {
  if (raw == null) return true;
  const value = raw.trim().toLowerCase();
  if (value === "") return true;
  return value !== "0" && value !== "false" && value !== "no" && value !== "off";
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
 * only after its lease (`transcriptNextAttemptAt`) has passed. A 404 stays
 * due forever; download failures stop after {@link MAX_TRANSCRIPT_ATTEMPTS}.
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
  if (status === "failed" && row.transcriptAttempts >= MAX_TRANSCRIPT_ATTEMPTS) {
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
}

/**
 * HTTP 404 from the website route. The transcript and marks stay put.
 * Attempts are not incremented, so waiting on the website cannot exhaust
 * the download retry budget.
 */
export function planWebsiteNotReady(
  now: Date,
  attempts: number
): TranscriptWritePlan {
  return {
    transcriptStatus: "website_not_ready",
    transcriptError: "Website route is not ready (HTTP 404). Will retry.",
    transcriptAttempts: attempts,
    transcriptNextAttemptAt: new Date(now.getTime() + WEBSITE_NOT_READY_BACKOFF_MS),
    transcriptScannedAt: null,
  };
}

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
  };
}
