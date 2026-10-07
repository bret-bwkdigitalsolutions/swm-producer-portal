/** Phrases Deepgram should boost on a live-recording transcription. */
export const MARK_CUE_KEYTERMS = ["mark that", "mark it", "mark this"] as const;

/** Cue must be strictly longer than this broadcast length. */
export const MIN_BROADCAST_SECONDS = 2 * 60;

/** Cue must be strictly shorter than this broadcast length. */
export const MAX_BROADCAST_SECONDS = 4 * 60 * 60;

/** How far before the cue the YouTube link seeks. */
export const MARK_LEAD_SECONDS = 10;

/** Drop a later cue when it starts within this many seconds of a kept one. */
export const MARK_DEDUPE_SECONDS = 30;

export const MARK_QUOTE_MAX_CHARS = 280;

export const MARK_QUOTE_UTTERANCES = 2;

/** Download / Deepgram / non-404 failures before the cron stops retrying. */
export const MAX_TRANSCRIPT_ATTEMPTS = 10;

/** First retry waits this long. Each later failure doubles it, up to the cap. */
export const TRANSCRIPT_BACKOFF_BASE_MS = 5 * 60 * 1000;

export const TRANSCRIPT_BACKOFF_CAP_MS = 60 * 60 * 1000;

/**
 * A claimed row stays out of the queue until this lease expires. The worker
 * pushes it forward after the download and after transcription.
 */
export const TRANSCRIPT_STALE_MS = 90 * 60 * 1000;

/** 404 from the website route. Not a hard failure; the cron tries again. */
export const WEBSITE_NOT_READY_BACKOFF_MS = 15 * 60 * 1000;

export const LIVE_MARKS_SOURCE = "live_transcript" as const;

export type TranscriptScanStatus =
  | "pending"
  | "processing"
  | "completed"
  | "skipped"
  | "website_not_ready"
  | "failed";
