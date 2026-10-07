import "server-only";

import { db } from "@/lib/db";
import { canTransition } from "./types";

/**
 * Transition a LiveRecording to the `archived` terminal state and push the
 * final state to its WordPress post so the theme stops rendering the
 * "stream ended, replay coming shortly" interstitial.
 *
 * Called from the polling cron once handoff has completed and the
 * Transistor episode ID is populated. The live-state poller stops here.
 * A mark-that transcription is queued separately and does not change
 * `state`.
 *
 * Writes the live-state meta so the theme drops the "replay coming shortly"
 * interstitial. Blog generation stays manual — the Transistor pipeline is
 * not wired for these episodes. Mark-that transcription is queued here
 * (`transcriptStatus = pending`); the live-transcription cron downloads
 * the YouTube VOD after that. See src/lib/live-marks/.
 */
export async function archiveLiveRecording(
  liveRecordingId: string
): Promise<{ ok: boolean; message?: string }> {
  const row = await db.liveRecording.findUnique({
    where: { id: liveRecordingId },
  });
  if (!row) {
    return { ok: false, message: `LiveRecording ${liveRecordingId} not found.` };
  }
  if (row.state === "archived") {
    return { ok: true, message: "Already archived." };
  }
  if (!row.transistorEpisodeId) {
    return {
      ok: false,
      message: "Cannot archive — handoff has not completed (no transistorEpisodeId).",
    };
  }
  if (!canTransition(row.state as "ended_pending" | "stuck", "archived")) {
    return {
      ok: false,
      message: `Cannot transition from '${row.state}' to 'archived'.`,
    };
  }

  const now = new Date();

  if (row.wpPostId) {
    try {
      await pushWpArchive({
        wpPostId: row.wpPostId,
        liveEndedAt: row.actualEndedAt,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "WP update failed";
      // Don't transition state if we couldn't update WP — let next poll retry.
      return {
        ok: false,
        message: `WP archive update failed: ${message}`,
      };
    }
  }

  await db.liveRecording.update({
    where: { id: row.id },
    data: {
      state: "archived",
      archivedAt: now,
      errorMessage: null,
      // Queue once. A retry of an already-archived row returns above, and a
      // scan that is already running or finished is left alone.
      ...(row.transcriptStatus == null
        ? { transcriptStatus: "pending" as const, transcriptNextAttemptAt: null }
        : {}),
    },
  });

  return { ok: true, message: "Archived." };
}

async function pushWpArchive(args: {
  wpPostId: number;
  liveEndedAt: Date | null;
}): Promise<void> {
  const { wpPostId, liveEndedAt } = args;
  const wpUrl = process.env.WP_API_URL;
  const wpUser = process.env.WP_APP_USER;
  const wpPassword = process.env.WP_APP_PASSWORD;
  if (!wpUrl || !wpUser || !wpPassword) {
    throw new Error("WP credentials missing");
  }
  const auth =
    "Basic " + Buffer.from(`${wpUser}:${wpPassword}`).toString("base64");

  const meta: Record<string, string> = {
    _swm_episode_live_state: "archived",
  };
  if (liveEndedAt) {
    meta._swm_episode_live_ended_at = liveEndedAt.toISOString();
  }

  const response = await fetch(`${wpUrl}/swm_episode/${wpPostId}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ meta }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WP archive update failed (${response.status}): ${body}`);
  }
}
