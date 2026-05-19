import type { LiveRecordingState } from "./types";
import type { YouTubeVideoLiveDetails } from "@/lib/youtube-api";

/**
 * How long after `actualEndTime` we wait before triggering the YouTube →
 * Transistor handoff. YouTube VOD processing is roughly 4-6× realtime for
 * recent live streams; 30 minutes covers most short broadcasts. The handoff
 * itself does its own download retry with backoff if yt-dlp is still
 * waiting on the archive when we try.
 */
export const HANDOFF_PROCESSING_WINDOW_MS = 30 * 60 * 1000;

export interface PollInput {
  currentState: LiveRecordingState;
  ytDetails: YouTubeVideoLiveDetails;
  now: Date;
}

export type PollDecision =
  | { action: "no_change" }
  | {
      action: "transition";
      to: LiveRecordingState;
      updates: {
        actualStartedAt?: Date;
        actualEndedAt?: Date;
      };
    }
  | { action: "trigger_handoff" };

/**
 * Pure state-machine reduction: given the portal's current state for a
 * recording and the latest YouTube API response, decide what to do.
 *
 * Key invariants:
 * - Only transitions out of `live` when `actualEndTime` is set. A bare
 *   `liveBroadcastContent="none"` is treated as transient YouTube eventual
 *   consistency and ignored.
 * - Scheduled → ended_pending is allowed when actualEndTime appears
 *   without us ever observing live, which can happen for short broadcasts
 *   between poll ticks.
 * - Terminal states (archived, cancelled, stuck) return no_change — the
 *   poller skips them entirely in production, but the function is defensive.
 */
export function deriveDecision(input: PollInput): PollDecision {
  const { currentState, ytDetails, now } = input;

  switch (currentState) {
    case "scheduled": {
      // If broadcast ended before we ever saw it live, jump straight to
      // ended_pending so the rest of the pipeline still runs.
      if (ytDetails.actualEndTime) {
        return {
          action: "transition",
          to: "ended_pending",
          updates: {
            actualStartedAt: ytDetails.actualStartTime ?? undefined,
            actualEndedAt: ytDetails.actualEndTime,
          },
        };
      }
      if (ytDetails.liveBroadcastContent === "live") {
        return {
          action: "transition",
          to: "live",
          updates: {
            actualStartedAt: ytDetails.actualStartTime ?? undefined,
          },
        };
      }
      // Still upcoming, or YT briefly reports 'none' without timestamps —
      // hold the line.
      return { action: "no_change" };
    }

    case "live": {
      // Only transition out when YouTube confirms the broadcast ended.
      // A bare `none` response without actualEndTime is transient and
      // ignored — this is the documented eventual-consistency guard.
      if (ytDetails.actualEndTime) {
        return {
          action: "transition",
          to: "ended_pending",
          updates: {
            actualEndedAt: ytDetails.actualEndTime,
          },
        };
      }
      return { action: "no_change" };
    }

    case "ended_pending": {
      // After the processing window, fire the handoff. The handoff path is
      // idempotent — repeated triggers don't create duplicate uploads.
      if (!ytDetails.actualEndTime) return { action: "no_change" };
      const elapsed = now.getTime() - ytDetails.actualEndTime.getTime();
      if (elapsed >= HANDOFF_PROCESSING_WINDOW_MS) {
        return { action: "trigger_handoff" };
      }
      return { action: "no_change" };
    }

    // Terminal / inactive states — the poller skips these in production,
    // but defensive no-op when called.
    case "archived":
    case "cancelled":
    case "stuck":
      return { action: "no_change" };
  }
}
