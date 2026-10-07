import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { deleteFile } from "@/lib/gcs";
import { downloadVideoToGcs } from "@/lib/jobs/video-downloader";
import {
  formatTranscriptAsVtt,
  transcribeAudio,
} from "@/lib/transcription";
import {
  LIVE_DEEPGRAM_TIMEOUT_MS,
  LIVE_DOWNLOAD_DEADLINE_MS,
  LIVE_DOWNLOAD_TIMEOUT_MS,
  MARK_CUE_KEYTERMS,
  TRANSCRIPT_STALE_MS,
} from "./constants";
import { evaluateBroadcastDuration } from "./duration";
import { writeOwnedScan } from "./lease";
import { detectMarks, type MarkUtterance } from "./matcher";
import {
  planConfigError,
  planContractError,
  planOverlapRetry,
  planTranscriptFailure,
  planWebsiteNotReady,
} from "./retry";
import { postLiveMarks } from "./website";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function readUtterances(value: unknown): MarkUtterance[] {
  if (!Array.isArray(value)) return [];
  const utterances: MarkUtterance[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.start !== "number" || typeof row.end !== "number") continue;
    if (typeof row.text !== "string") continue;
    utterances.push({ start: row.start, end: row.end, text: row.text });
  }
  return utterances;
}

async function extendLease(id: string, token: string): Promise<boolean> {
  return writeOwnedScan(id, token, {
    transcriptNextAttemptAt: new Date(Date.now() + TRANSCRIPT_STALE_MS),
  });
}

/**
 * Delete the stored mp3 after a transcript exists. A later 404 retry uses
 * the saved transcript and does not need the object. A delete failure
 * leaves the path in place so a later pass can try again.
 */
async function discardAudio(
  id: string,
  token: string,
  path: string | null
): Promise<"cleared" | "kept" | "lost"> {
  if (!path) return "cleared";
  try {
    await deleteFile(path);
  } catch (error) {
    console.error(
      `[live-transcription] ${id}: could not delete audio ${path}`,
      error
    );
    return "kept";
  }
  const cleared = await writeOwnedScan(id, token, { transcriptAudioPath: null });
  return cleared ? "cleared" : "lost";
}

function lostLease(message = "Lost the scan lease."): {
  ok: boolean;
  message: string;
} {
  return { ok: true, message };
}

/**
 * Download the YouTube VOD (when needed), transcribe it, detect mark cues,
 * and POST them. `token` is the claim token from the queue. Every write
 * requires that token; a stale worker's writes match nothing.
 * A stored transcript is reused, so a website 404 retry does not call
 * Deepgram again. The mp3 is deleted once the transcript is saved.
 * The cron posts only when there is at least one mark. An admin Re-scan
 * sets `liveScanAdminRescan` and posts `marks: []` when it finds none, so
 * the website clears stale marks. A cron retry of that scan still sends
 * the empty list. The flag is cleared after the post succeeds.
 */
export async function runLiveTranscription(
  liveRecordingId: string,
  token: string,
  options?: { adminRescan?: boolean }
): Promise<{ ok: boolean; message: string }> {
  const row = await db.liveRecording.findUnique({
    where: { id: liveRecordingId },
  });
  if (!row) return { ok: false, message: "LiveRecording not found." };
  if (row.state !== "archived") {
    return { ok: false, message: `Refusing to transcribe state '${row.state}'.` };
  }
  if (row.transcriptStatus !== "processing" || row.transcriptClaimToken !== token) {
    return { ok: true, message: "Not the claimed scan." };
  }

  try {
    if (row.transcriptVtt == null) {
      const duration = evaluateBroadcastDuration(
        row.actualStartedAt,
        row.actualEndedAt
      );
      if (!duration.ok) {
        const wrote = await writeOwnedScan(row.id, token, {
          transcriptStatus: "skipped",
          transcriptError: duration.reason,
          transcriptDurationSec: duration.seconds,
          transcriptNextAttemptAt: null,
          transcriptClaimToken: null,
        });
        if (!wrote) return lostLease();
        return { ok: true, message: duration.reason ?? "Skipped." };
      }

      const durationSaved = await writeOwnedScan(row.id, token, {
        transcriptDurationSec: duration.seconds,
      });
      if (!durationSaved) return lostLease();

      let audioPath = row.transcriptAudioPath;
      if (!audioPath) {
        const youtubeUrl = `https://www.youtube.com/watch?v=${row.youtubeVideoId}`;
        console.log(
          `[live-transcription] ${row.id}: downloading YouTube VOD ${row.youtubeVideoId}`
        );
        audioPath = await downloadVideoToGcs(youtubeUrl, row.id, row.wpShowId, {
          timeoutMs: LIVE_DOWNLOAD_TIMEOUT_MS,
          signal: AbortSignal.timeout(LIVE_DOWNLOAD_DEADLINE_MS),
        });
        const saved = await writeOwnedScan(row.id, token, {
          transcriptAudioPath: audioPath,
        });
        if (!saved) return lostLease("Lost the scan lease during download.");
        const extended = await extendLease(row.id, token);
        if (!extended) return lostLease();
      }

      const showMeta = await db.showMetadata.findUnique({
        where: { wpShowId: row.wpShowId },
        select: { hosts: true, language: true },
      });
      const forceLanguage =
        showMeta?.language && showMeta.language !== "en"
          ? showMeta.language
          : undefined;
      console.log(`[live-transcription] ${row.id}: transcribing ${audioPath}`);
      const transcription = await transcribeAudio(audioPath, {
        forceLanguage,
        wpShowId: row.wpShowId,
        hosts: showMeta?.hosts,
        extraKeyterms: [...MARK_CUE_KEYTERMS],
        timeoutMs: LIVE_DEEPGRAM_TIMEOUT_MS,
      });
      const utterances: MarkUtterance[] = transcription.segments
        .filter((segment) => segment.text?.trim())
        .map((segment) => ({
          start: segment.start,
          end: segment.end,
          text: segment.text.trim(),
        }));
      const saved = await writeOwnedScan(row.id, token, {
        transcriptVtt: formatTranscriptAsVtt(transcription.segments),
        transcriptUtterances: asJson(utterances),
        transcriptNextAttemptAt: new Date(Date.now() + TRANSCRIPT_STALE_MS),
      });
      if (!saved) return lostLease("Lost the scan lease during transcription.");
      const discarded = await discardAudio(row.id, token, audioPath);
      if (discarded === "lost") return lostLease();
    }

    const fresh = await db.liveRecording.findUnique({ where: { id: row.id } });
    if (
      !fresh ||
      fresh.transcriptStatus !== "processing" ||
      fresh.transcriptClaimToken !== token
    ) {
      return lostLease("Lost the scan lease before sending marks.");
    }

    if (fresh.transcriptVtt != null && fresh.transcriptAudioPath) {
      const discarded = await discardAudio(
        fresh.id,
        token,
        fresh.transcriptAudioPath
      );
      if (discarded === "lost") return lostLease();
    }

    const marks = detectMarks(readUtterances(fresh.transcriptUtterances));
    const marksSaved = await writeOwnedScan(fresh.id, token, {
      transcriptMarks: asJson(marks),
    });
    if (!marksSaved) return lostLease();

    const clearStaleMarks =
      options?.adminRescan === true || fresh.liveScanAdminRescan === true;
    if (marks.length === 0 && !clearStaleMarks) {
      const wrote = await writeOwnedScan(fresh.id, token, {
        transcriptStatus: "completed",
        transcriptError: null,
        transcriptNextAttemptAt: null,
        transcriptScannedAt: new Date(),
        transcriptMarksResponse: Prisma.DbNull,
        transcriptClaimToken: null,
        transcriptNotReadySince: null,
      });
      if (!wrote) return lostLease();
      console.log(`[live-transcription] ${fresh.id}: scanned, no marks`);
      return { ok: true, message: "Scanned. No marks to send." };
    }

    const posted = await postLiveMarks({
      wpShowId: fresh.wpShowId,
      youtubeVideoId: fresh.youtubeVideoId,
      marks,
    });

    if (!posted.ok && posted.kind === "website_not_ready") {
      const plan = planWebsiteNotReady(
        new Date(),
        fresh.transcriptAttempts,
        fresh.transcriptNotReadySince
      );
      const wrote = await writeOwnedScan(fresh.id, token, plan);
      if (!wrote) return lostLease();
      console.log(`[live-transcription] ${fresh.id}: website route not ready`);
      return { ok: true, message: plan.transcriptError ?? "Website not ready." };
    }

    if (!posted.ok && posted.kind === "overlap") {
      const plan = planOverlapRetry(
        new Date(),
        fresh.transcriptAttempts,
        posted.message
      );
      const wrote = await writeOwnedScan(fresh.id, token, plan);
      if (!wrote) return lostLease();
      console.log(`[live-transcription] ${fresh.id}: ${posted.message}`);
      return { ok: true, message: plan.transcriptError ?? posted.message };
    }

    if (!posted.ok && posted.kind === "config") {
      const plan = planConfigError(fresh.transcriptAttempts, posted.message);
      const wrote = await writeOwnedScan(fresh.id, token, plan);
      if (!wrote) return lostLease();
      console.error(`[live-transcription] ${fresh.id}: ${posted.message}`);
      return { ok: false, message: plan.transcriptError ?? posted.message };
    }

    if (!posted.ok && posted.kind === "contract") {
      const plan = planContractError(fresh.transcriptAttempts, posted.message);
      const wrote = await writeOwnedScan(fresh.id, token, plan);
      if (!wrote) return lostLease();
      console.error(`[live-transcription] ${fresh.id}: ${posted.message}`);
      return { ok: false, message: plan.transcriptError ?? posted.message };
    }

    if (!posted.ok) {
      throw new Error(posted.message);
    }

    const wrote = await writeOwnedScan(fresh.id, token, {
      transcriptStatus: "completed",
      transcriptError: null,
      transcriptNextAttemptAt: null,
      transcriptScannedAt: new Date(),
      transcriptMarksResponse: asJson(posted.response),
      transcriptClaimToken: null,
      transcriptNotReadySince: null,
      liveScanAdminRescan: false,
    });
    if (!wrote) return lostLease("Lost the scan lease after the website call.");
    const cleared = marks.length === 0;
    console.log(
      cleared
        ? `[live-transcription] ${fresh.id}: cleared live marks, stored ${posted.response.stored}`
        : `[live-transcription] ${fresh.id}: sent ${marks.length} mark(s), stored ${posted.response.stored}`
    );
    return {
      ok: true,
      message: cleared
        ? "Sent an empty mark list so the website clears stale live marks."
        : `Sent ${marks.length} mark(s). Website stored ${posted.response.stored}.`,
    };
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : "Live transcription failed"
    ).slice(0, 2000);
    console.error(`[live-transcription] ${row.id} failed:`, error);
    const current = await db.liveRecording.findUnique({
      where: { id: row.id },
      select: {
        transcriptStatus: true,
        transcriptAttempts: true,
        transcriptClaimToken: true,
      },
    });
    if (
      !current ||
      current.transcriptStatus !== "processing" ||
      current.transcriptClaimToken !== token
    ) {
      return { ok: false, message };
    }
    const plan = planTranscriptFailure(
      new Date(),
      current.transcriptAttempts,
      message
    );
    await writeOwnedScan(row.id, token, plan);
    return { ok: false, message: plan.transcriptError ?? message };
  }
}
