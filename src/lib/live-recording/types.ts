export const LIVE_RECORDING_STATES = [
  "scheduled",
  "live",
  "ended_pending",
  "archived",
  "cancelled",
  "stuck",
] as const;

export type LiveRecordingState = (typeof LIVE_RECORDING_STATES)[number];

/**
 * The states the polling cron walks. Other states (archived, cancelled) are
 * terminal — the poller skips them entirely.
 */
export const ACTIVE_LIVE_RECORDING_STATES: ReadonlySet<LiveRecordingState> =
  new Set(["scheduled", "live", "ended_pending"]);

export function isLiveRecordingState(value: string): value is LiveRecordingState {
  return (LIVE_RECORDING_STATES as readonly string[]).includes(value);
}

export const LIVE_RECORDING_STATE_LABELS: Record<LiveRecordingState, string> = {
  scheduled: "Scheduled",
  live: "Live",
  ended_pending: "Ended, processing",
  archived: "Archived",
  cancelled: "Cancelled",
  stuck: "Stuck",
};

/**
 * Allowed state transitions. The state machine is intentionally narrow — most
 * transitions are driven by the polling cron observing YouTube state, with a
 * few admin-driven transitions (cancel from any non-terminal state, retry
 * stuck → ended_pending, force archive stuck → archived).
 *
 * Note that scheduled → ended_pending is allowed: a broadcast that ends before
 * the portal observes it as "live" (e.g., very short stream + 2-minute poll
 * window) should still transition cleanly into the post-broadcast pipeline.
 */
const TRANSITIONS: Record<LiveRecordingState, ReadonlySet<LiveRecordingState>> = {
  scheduled: new Set(["live", "ended_pending", "cancelled"]),
  live: new Set(["ended_pending", "cancelled"]),
  ended_pending: new Set(["archived", "stuck", "cancelled"]),
  stuck: new Set(["ended_pending", "archived", "cancelled"]),
  archived: new Set(),
  cancelled: new Set(),
};

export function canTransition(
  from: LiveRecordingState,
  to: LiveRecordingState
): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].has(to);
}

export interface LiveRecordingSummary {
  id: string;
  wpShowId: number;
  wpPostId: number | null;
  youtubeVideoId: string;
  youtubeLiveUrl: string;
  title: string;
  scheduledStartAt: Date;
  state: LiveRecordingState;
  transistorEpisodeId: string | null;
  actualStartedAt: Date | null;
  actualEndedAt: Date | null;
  archivedAt: Date | null;
  errorMessage: string | null;
}
