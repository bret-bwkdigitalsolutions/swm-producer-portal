import "server-only";

import { db } from "@/lib/db";
import { canTransition } from "./types";

/**
 * Transition a LiveRecording to the `archived` terminal state and push the
 * final state to its WordPress post so the theme stops rendering the
 * "stream ended, replay coming shortly" interstitial.
 *
 * Called from the polling cron once handoff has completed and the
 * Transistor episode ID is populated. After this fires, the LiveRecording
 * is dormant — no further polling, no further action from the portal
 * unless admin intervenes.
 *
 * v1 scope: writes only the live-state meta + the YouTube embed URL.
 * Transcription, AI-generated blog content, and other pipeline outputs
 * are NOT auto-generated for live recordings in v1 because the existing
 * Transistor → DistributionJob plumbing isn't wired up for scraper-
 * originated episodes. Producers can trigger blog generation manually
 * via the existing /admin/blog-ideas flow once an episode is live on
 * Transistor. See "Deferred Implementation Questions" in the plan.
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
