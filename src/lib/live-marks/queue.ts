import "server-only";

import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/job-queue";
import { MAX_TRANSCRIPT_ATTEMPTS, TRANSCRIPT_STALE_MS } from "./constants";
import { isLiveTranscriptionEnabled, isTranscriptDue } from "./retry";
import { runLiveTranscription } from "./worker";

/**
 * Claim one archived row for a scan. The lease (`transcriptNextAttemptAt`)
 * keeps the next cron tick from starting a second download of the same VOD.
 */
export async function claimLiveTranscription(
  id: string,
  now: Date
): Promise<boolean> {
  const result = await db.liveRecording.updateMany({
    where: {
      id,
      state: "archived",
      OR: [
        { transcriptStatus: "pending" },
        { transcriptStatus: "website_not_ready" },
        {
          transcriptStatus: "failed",
          transcriptAttempts: { lt: MAX_TRANSCRIPT_ATTEMPTS },
        },
        { transcriptStatus: "processing" },
      ],
      AND: [
        {
          OR: [
            { transcriptNextAttemptAt: null },
            { transcriptNextAttemptAt: { lte: now } },
          ],
        },
      ],
    },
    data: {
      transcriptStatus: "processing",
      transcriptNextAttemptAt: new Date(now.getTime() + TRANSCRIPT_STALE_MS),
      transcriptError: null,
    },
  });
  return result.count === 1;
}

function enqueue(id: string): void {
  enqueueJob(`live-transcript:${id}`, () => runLiveTranscription(id));
}

/**
 * Queue at most one due scan. Historical rows with a null status are left
 * alone; archive sets `pending`, and an admin re-scan does too.
 * No-ops when LIVE_TRANSCRIPTION_ENABLED is off.
 */
export async function queueDueLiveTranscriptions(now = new Date()): Promise<{
  queued: string[];
  disabled: boolean;
}> {
  if (!isLiveTranscriptionEnabled()) {
    return { queued: [], disabled: true };
  }

  const rows = await db.liveRecording.findMany({
    where: {
      state: "archived",
      OR: [
        { transcriptStatus: "pending" },
        { transcriptStatus: "website_not_ready" },
        {
          transcriptStatus: "failed",
          transcriptAttempts: { lt: MAX_TRANSCRIPT_ATTEMPTS },
        },
        { transcriptStatus: "processing" },
      ],
    },
    orderBy: [{ transcriptNextAttemptAt: "asc" }, { archivedAt: "asc" }],
    take: 25,
  });

  for (const row of rows) {
    if (!isTranscriptDue(row, now)) continue;
    const claimed = await claimLiveTranscription(row.id, now);
    if (!claimed) continue;
    enqueue(row.id);
    return { queued: [row.id], disabled: false };
  }
  return { queued: [], disabled: false };
}

/**
 * Admin re-scan. Reuses a stored transcript (no second Deepgram call) and
 * runs even when the env flag is off, so one recording can be tried on
 * staging without turning the cron loose.
 */
export async function requestLiveRescan(
  id: string
): Promise<{ ok: boolean; message: string }> {
  const row = await db.liveRecording.findUnique({ where: { id } });
  if (!row) return { ok: false, message: "Recording not found." };
  if (row.state !== "archived") {
    return {
      ok: false,
      message: "Marks are scanned after the recording is archived.",
    };
  }
  if (
    row.transcriptStatus === "processing" &&
    row.transcriptNextAttemptAt &&
    row.transcriptNextAttemptAt.getTime() > Date.now()
  ) {
    return { ok: false, message: "A scan is already running." };
  }

  await db.liveRecording.update({
    where: { id },
    data: {
      transcriptStatus: "pending",
      transcriptAttempts: 0,
      transcriptNextAttemptAt: null,
      transcriptError: null,
      transcriptScannedAt: null,
    },
  });

  const claimed = await claimLiveTranscription(id, new Date());
  if (claimed) {
    enqueue(id);
    return {
      ok: true,
      message:
        "Re-scan queued. The saved transcript is reused when one exists.",
    };
  }
  const again = await db.liveRecording.findUnique({
    where: { id },
    select: { transcriptStatus: true },
  });
  if (again?.transcriptStatus === "processing") {
    return { ok: true, message: "Re-scan already running." };
  }
  return { ok: false, message: "Could not queue a re-scan." };
}
