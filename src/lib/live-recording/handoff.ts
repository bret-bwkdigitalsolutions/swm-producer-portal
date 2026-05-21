import "server-only";

import { db } from "@/lib/db";
import { downloadVideoToGcs } from "@/lib/jobs/video-downloader";
import { uploadToTransistor } from "@/lib/platforms/transistor";
import { canTransition, type LiveRecordingState } from "./types";

/**
 * After this many consecutive failed download/upload attempts, transition
 * the recording to `stuck` so admin must intervene. Default 5 — matches
 * U5 test scenarios in the plan. Tunable per the deferred questions.
 */
export const STUCK_THRESHOLD = 5;

export interface HandoffResult {
  ok: boolean;
  /** True iff this call newly populated transistorEpisodeId (handoff
   * actually completed). Idempotent calls on an already-handed-off
   * recording return ok:true, alreadyHandedOff:true. */
  alreadyHandedOff?: boolean;
  /** True iff this call transitioned the recording to `stuck`. */
  stuck?: boolean;
  message?: string;
  transistorEpisodeId?: string;
}

/**
 * Run the YouTube → Transistor handoff for a single recording. Designed
 * to be invoked by the polling cron's trigger_handoff decision, OR by
 * admin retry after a stuck state.
 *
 * Idempotent on success — if transistorEpisodeId is already populated,
 * the function short-circuits with `alreadyHandedOff: true` and does
 * NOT re-upload. This guards against the poller racing itself if a
 * previous handoff call is mid-flight while a new tick begins.
 *
 * On failure, increments downloadAttempts. Once attempts reach
 * STUCK_THRESHOLD, transitions the recording to `stuck` with an error
 * message so admin can intervene.
 */
export async function runHandoff(
  liveRecordingId: string
): Promise<HandoffResult> {
  const row = await db.liveRecording.findUnique({
    where: { id: liveRecordingId },
  });
  if (!row) {
    return { ok: false, message: `LiveRecording ${liveRecordingId} not found.` };
  }

  // Idempotency guard — never re-upload if we already have an episode.
  if (row.transistorEpisodeId) {
    return {
      ok: true,
      alreadyHandedOff: true,
      transistorEpisodeId: row.transistorEpisodeId,
      message: "Already handed off to Transistor.",
    };
  }

  // Only ended_pending recordings should be handed off. Other states
  // (live, scheduled, archived, cancelled, stuck) need different paths.
  // Admin retry on a `stuck` recording resets state to ended_pending
  // before calling this function (see U7).
  if (row.state !== "ended_pending") {
    return {
      ok: false,
      message: `Refusing to hand off recording in state '${row.state}'. Must be ended_pending.`,
    };
  }

  try {
    // 1. Download the audio to GCS. Prefer the Vimeo source URL when the
    //    admin supplied one (more reliable than scraping the YouTube VOD);
    //    fall back to the YouTube broadcast URL otherwise. yt-dlp fails with
    //    a clear error if the source isn't ready yet — the retry logic below
    //    catches that and backs off.
    const downloadUrl = row.vimeoSourceUrl ?? row.youtubeLiveUrl;
    const gcsAudioPath = await downloadVideoToGcs(downloadUrl, row.id);

    // 2. Upload from GCS to Transistor using the existing wrapper that
    //    knows about per-show credentials and the upload sequence.
    const result = await uploadToTransistor({
      wpShowId: row.wpShowId,
      title: row.title,
      description: row.description ?? "",
      gcsAudioPath,
      youtubeVideoUrl: row.youtubeLiveUrl,
    });

    // 3. Stamp the Transistor episode ID on the row. The Transistor
    //    scraper will pick up the new episode on its next run and the
    //    pipeline's update-in-place branch (U6) routes its output back
    //    to this same wpPostId.
    await db.liveRecording.update({
      where: { id: row.id },
      data: {
        transistorEpisodeId: result.episodeId,
        downloadAttempts: 0,
        errorMessage: null,
      },
    });

    return {
      ok: true,
      transistorEpisodeId: result.episodeId,
      message: `Handed off to Transistor (episode ${result.episodeId}).`,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown handoff error";
    const newAttempts = row.downloadAttempts + 1;
    const goStuck = newAttempts >= STUCK_THRESHOLD;
    const targetState: LiveRecordingState = goStuck ? "stuck" : "ended_pending";

    // Defensive: confirm the transition is legal before persisting.
    if (goStuck && !canTransition("ended_pending", "stuck")) {
      throw new Error("State machine forbids ended_pending → stuck (bug)");
    }

    await db.liveRecording.update({
      where: { id: row.id },
      data: {
        downloadAttempts: newAttempts,
        errorMessage: message,
        ...(goStuck ? { state: targetState } : {}),
      },
    });

    return {
      ok: false,
      stuck: goStuck,
      message: goStuck
        ? `Handoff failed ${newAttempts} times — marked stuck. Last error: ${message}`
        : `Handoff failed (attempt ${newAttempts}/${STUCK_THRESHOLD}): ${message}`,
    };
  }
}
