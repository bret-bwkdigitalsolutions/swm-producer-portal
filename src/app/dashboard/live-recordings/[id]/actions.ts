"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { canTransition, type LiveRecordingState } from "@/lib/live-recording/types";
import { runHandoff } from "@/lib/live-recording/handoff";
import { archiveLiveRecording } from "@/lib/live-recording/archive";
import { revalidatePath } from "next/cache";

interface ActionResult {
  success?: boolean;
  message?: string;
}

/**
 * Cancel a scheduled/live/ended_pending/stuck recording. Sets state to
 * cancelled, and unpublishes the WP post (sets status to "private") so
 * it disappears from the public site. Polling automatically stops because
 * cancelled is not an active state.
 */
export async function cancelLiveRecording(
  liveRecordingId: string
): Promise<ActionResult> {
  const session = await requireAdmin();

  const row = await db.liveRecording.findUnique({
    where: { id: liveRecordingId },
  });
  if (!row) return { success: false, message: "Recording not found." };

  if (!canTransition(row.state as LiveRecordingState, "cancelled")) {
    return {
      success: false,
      message: `Cannot cancel from state '${row.state}'.`,
    };
  }

  // Best-effort WP unpublish — log failure but don't block the portal-side
  // state transition.
  if (row.wpPostId) {
    try {
      await unpublishWpPost(row.wpPostId);
    } catch (error) {
      console.error(
        `[cancelLiveRecording] WP unpublish failed for post ${row.wpPostId}:`,
        error
      );
    }
  }

  await db.liveRecording.update({
    where: { id: row.id },
    data: { state: "cancelled" },
  });

  await db.activityLog.create({
    data: {
      userId: session.user.id,
      action: "cancel",
      contentType: "live_recording",
      wpPostId: row.wpPostId ?? null,
      wpShowId: row.wpShowId,
    },
  });

  revalidatePath("/dashboard/live-recordings");
  revalidatePath(`/dashboard/live-recordings/${row.id}`);
  return { success: true, message: "Recording cancelled." };
}

/**
 * Retry a stuck recording. Resets downloadAttempts so the next handoff
 * attempt gets a fresh budget, transitions state back to ended_pending,
 * and fires runHandoff immediately rather than waiting for the next
 * poll cycle.
 */
export async function retryStuckLiveRecording(
  liveRecordingId: string
): Promise<ActionResult> {
  const session = await requireAdmin();

  const row = await db.liveRecording.findUnique({
    where: { id: liveRecordingId },
  });
  if (!row) return { success: false, message: "Recording not found." };

  if (row.state !== "stuck") {
    return {
      success: false,
      message: `Retry is only valid from stuck state (current: ${row.state}).`,
    };
  }

  await db.liveRecording.update({
    where: { id: row.id },
    data: {
      state: "ended_pending",
      downloadAttempts: 0,
      errorMessage: null,
    },
  });

  await db.activityLog.create({
    data: {
      userId: session.user.id,
      action: "retry",
      contentType: "live_recording",
      wpPostId: row.wpPostId ?? null,
      wpShowId: row.wpShowId,
    },
  });

  // Fire the handoff immediately. Result is logged for admin visibility
  // and surfaces on the next page render via the row's state/error fields.
  const result = await runHandoff(row.id);

  revalidatePath("/dashboard/live-recordings");
  revalidatePath(`/dashboard/live-recordings/${row.id}`);
  return {
    success: result.ok,
    message: result.message ?? (result.ok ? "Retry succeeded." : "Retry failed."),
  };
}

/**
 * Force-archive bypasses the handoff. Useful when admin manually
 * resolved the upload outside the portal (e.g., uploaded to Transistor
 * by hand) and just wants the WP post and portal row to close the
 * lifecycle. Requires the admin to have set transistorEpisodeId
 * manually if they want pipeline tooling to find it — but the archive
 * itself only needs WP-side closure.
 */
export async function forceArchiveLiveRecording(
  liveRecordingId: string
): Promise<ActionResult> {
  const session = await requireAdmin();

  const row = await db.liveRecording.findUnique({
    where: { id: liveRecordingId },
  });
  if (!row) return { success: false, message: "Recording not found." };

  if (row.state !== "stuck" && row.state !== "ended_pending") {
    return {
      success: false,
      message: `Force archive is only valid from stuck or ended_pending (current: ${row.state}).`,
    };
  }

  // If no transistorEpisodeId yet, populate a sentinel so archiveLive's
  // guard passes. Admin is explicitly bypassing the handoff requirement
  // by clicking this button.
  if (!row.transistorEpisodeId) {
    await db.liveRecording.update({
      where: { id: row.id },
      data: { transistorEpisodeId: `manual-${row.id}` },
    });
  }

  const result = await archiveLiveRecording(row.id);

  await db.activityLog.create({
    data: {
      userId: session.user.id,
      action: "force_archive",
      contentType: "live_recording",
      wpPostId: row.wpPostId ?? null,
      wpShowId: row.wpShowId,
    },
  });

  revalidatePath("/dashboard/live-recordings");
  revalidatePath(`/dashboard/live-recordings/${row.id}`);
  return {
    success: result.ok,
    message: result.message,
  };
}

async function unpublishWpPost(wpPostId: number): Promise<void> {
  const wpUrl = process.env.WP_API_URL;
  const wpUser = process.env.WP_APP_USER;
  const wpPassword = process.env.WP_APP_PASSWORD;
  if (!wpUrl || !wpUser || !wpPassword) {
    throw new Error("WP credentials missing");
  }
  const auth =
    "Basic " + Buffer.from(`${wpUser}:${wpPassword}`).toString("base64");

  const response = await fetch(`${wpUrl}/swm_episode/${wpPostId}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "private",
      meta: { _swm_episode_live_state: "cancelled" },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `WP unpublish failed (${response.status}): ${await response.text()}`
    );
  }
}
