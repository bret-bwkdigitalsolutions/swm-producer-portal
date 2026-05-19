import "server-only";

import { db } from "@/lib/db";
import { getVideoLiveDetails } from "@/lib/youtube-api";
import { getYouTubeAccessToken } from "@/lib/analytics/credentials";
import {
  deriveDecision,
  type PollDecision,
} from "@/lib/live-recording/youtube-state";
import {
  ACTIVE_LIVE_RECORDING_STATES,
  canTransition,
  type LiveRecordingState,
} from "@/lib/live-recording/types";

/**
 * Hourly window around scheduledStartAt within which we actively poll
 * recordings still in `scheduled` state. Far-future recordings sleep so
 * the cron stays cheap even when many are scheduled days in advance.
 */
const SCHEDULED_POLL_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface PollSummary {
  totalChecked: number;
  transitions: Array<{
    id: string;
    from: LiveRecordingState;
    to: LiveRecordingState;
  }>;
  handoffsTriggered: string[];
  failures: Array<{ id: string; error: string }>;
}

/**
 * Selector for rows the poll worker should examine. Live + ended_pending
 * are always polled. Scheduled is polled only when scheduledStartAt is
 * within the active window.
 */
async function listActiveRecordings(now: Date) {
  const earliest = new Date(now.getTime() - SCHEDULED_POLL_WINDOW_MS);
  const latest = new Date(now.getTime() + SCHEDULED_POLL_WINDOW_MS);
  return db.liveRecording.findMany({
    where: {
      OR: [
        { state: "live" },
        { state: "ended_pending" },
        {
          state: "scheduled",
          scheduledStartAt: { gte: earliest, lte: latest },
        },
      ],
    },
    orderBy: { scheduledStartAt: "asc" },
  });
}

/**
 * Trigger the YouTube → Transistor handoff for one recording. Stubbed
 * for now; replaced by U5's real implementation. The stub still records
 * the trigger so the poll summary stays accurate during incremental ship.
 */
async function triggerHandoff(liveRecordingId: string): Promise<void> {
  console.log(
    `[live-recording-poll] Handoff trigger (stub) for ${liveRecordingId} — wire up runHandoff() once U5 lands.`
  );
}

/**
 * Push a state transition to the linked WP swm_episode post. Writes the
 * minimum meta needed to drive the theme's branching, plus the
 * actualStartedAt/actualEndedAt timestamps when present.
 */
async function pushWpStateUpdate(args: {
  wpPostId: number;
  newState: LiveRecordingState;
  actualStartedAt: Date | null;
  actualEndedAt: Date | null;
}): Promise<void> {
  const { wpPostId, newState, actualStartedAt, actualEndedAt } = args;
  const wpUrl = process.env.WP_API_URL;
  const wpUser = process.env.WP_APP_USER;
  const wpPassword = process.env.WP_APP_PASSWORD;
  if (!wpUrl || !wpUser || !wpPassword) {
    throw new Error("WP credentials missing");
  }
  const auth =
    "Basic " + Buffer.from(`${wpUser}:${wpPassword}`).toString("base64");

  const meta: Record<string, string> = {
    _swm_episode_live_state: newState,
  };
  if (actualStartedAt) {
    meta._swm_episode_live_started_at = actualStartedAt.toISOString();
  }
  if (actualEndedAt) {
    meta._swm_episode_live_ended_at = actualEndedAt.toISOString();
  }

  const response = await fetch(`${wpUrl}/swm_episode/${wpPostId}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ meta }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WP update failed (${response.status}): ${body}`);
  }
}

/**
 * One poll cycle. Walks active recordings, calls YouTube, applies the
 * deriveDecision verdict per row, isolates errors so one stuck recording
 * doesn't drag down the rest of the batch.
 */
export async function pollLiveRecordings(now: Date = new Date()): Promise<PollSummary> {
  const summary: PollSummary = {
    totalChecked: 0,
    transitions: [],
    handoffsTriggered: [],
    failures: [],
  };

  const rows = await listActiveRecordings(now);
  for (const row of rows) {
    summary.totalChecked++;
    try {
      const accessToken = await getYouTubeAccessToken(row.wpShowId);
      if (!accessToken) {
        throw new Error(
          `No YouTube credential configured for show ${row.wpShowId}`
        );
      }

      const ytDetails = await getVideoLiveDetails(
        accessToken,
        row.youtubeVideoId
      );
      if (!ytDetails) {
        throw new Error(
          `YouTube returned no video for id ${row.youtubeVideoId} — was it deleted?`
        );
      }

      // Defensive: skip rows in non-active states even if our query slipped
      // them in for some reason.
      if (!ACTIVE_LIVE_RECORDING_STATES.has(row.state as LiveRecordingState)) {
        await db.liveRecording.update({
          where: { id: row.id },
          data: { lastPolledAt: now, pollAttempts: { increment: 1 } },
        });
        continue;
      }

      const decision = deriveDecision({
        currentState: row.state as LiveRecordingState,
        ytDetails,
        now,
      });

      await applyDecision(row, decision, now, summary);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown poll error";
      summary.failures.push({ id: row.id, error: message });
      console.error(`[live-recording-poll] Row ${row.id} failed:`, message);
      // Still update lastPolledAt so the next tick doesn't immediately retry
      // on a cooldown the implementation may add later.
      await db.liveRecording
        .update({
          where: { id: row.id },
          data: {
            lastPolledAt: now,
            pollAttempts: { increment: 1 },
            errorMessage: message,
          },
        })
        .catch(() => {
          /* swallow secondary failure to update */
        });
    }
  }

  return summary;
}

async function applyDecision(
  row: { id: string; state: string; wpPostId: number | null },
  decision: PollDecision,
  now: Date,
  summary: PollSummary
): Promise<void> {
  if (decision.action === "no_change") {
    await db.liveRecording.update({
      where: { id: row.id },
      data: { lastPolledAt: now, pollAttempts: { increment: 1 } },
    });
    return;
  }

  if (decision.action === "trigger_handoff") {
    await db.liveRecording.update({
      where: { id: row.id },
      data: { lastPolledAt: now, pollAttempts: { increment: 1 } },
    });
    await triggerHandoff(row.id);
    summary.handoffsTriggered.push(row.id);
    return;
  }

  // action === "transition"
  const from = row.state as LiveRecordingState;
  const to = decision.to;
  if (!canTransition(from, to)) {
    throw new Error(
      `Illegal state machine transition: ${from} → ${to}. ` +
        `deriveDecision returned a transition the state machine forbids — ` +
        `tighten the predicate.`
    );
  }

  await db.liveRecording.update({
    where: { id: row.id },
    data: {
      state: to,
      lastPolledAt: now,
      pollAttempts: { increment: 1 },
      ...(decision.updates.actualStartedAt
        ? { actualStartedAt: decision.updates.actualStartedAt }
        : {}),
      ...(decision.updates.actualEndedAt
        ? { actualEndedAt: decision.updates.actualEndedAt }
        : {}),
    },
  });

  if (row.wpPostId) {
    await pushWpStateUpdate({
      wpPostId: row.wpPostId,
      newState: to,
      actualStartedAt: decision.updates.actualStartedAt ?? null,
      actualEndedAt: decision.updates.actualEndedAt ?? null,
    });
  }

  summary.transitions.push({ id: row.id, from, to });
}
