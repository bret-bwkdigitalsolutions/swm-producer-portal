import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { downloadVideoToGcs } from "@/lib/jobs/video-downloader";
import {
  formatTranscriptAsVtt,
  transcribeAudio,
} from "@/lib/transcription";
import { MARK_CUE_KEYTERMS, TRANSCRIPT_STALE_MS } from "./constants";
import { evaluateBroadcastDuration } from "./duration";
import { detectMarks, type MarkUtterance } from "./matcher";
import {
  planConfigError,
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

async function stillProcessing(id: string): Promise<boolean> {
  const row = await db.liveRecording.findUnique({
    where: { id },
    select: { transcriptStatus: true },
  });
  return row?.transcriptStatus === "processing";
}

async function extendLease(id: string): Promise<void> {
  await db.liveRecording.updateMany({
    where: { id, transcriptStatus: "processing" },
    data: {
      transcriptNextAttemptAt: new Date(Date.now() + TRANSCRIPT_STALE_MS),
    },
  });
}

/**
 * Download the YouTube VOD (when needed), transcribe it, detect mark cues,
 * and POST them. The caller must have claimed the row (`transcriptStatus`
 * is `processing`). A stored transcript is reused, so a website 404 retry
 * does not call Deepgram again.
 */
export async function runLiveTranscription(
  liveRecordingId: string
): Promise<{ ok: boolean; message: string }> {
  const row = await db.liveRecording.findUnique({
    where: { id: liveRecordingId },
  });
  if (!row) return { ok: false, message: "LiveRecording not found." };
  if (row.state !== "archived") {
    return { ok: false, message: `Refusing to transcribe state '${row.state}'.` };
  }
  if (row.transcriptStatus !== "processing") {
    return { ok: true, message: "Not the claimed scan." };
  }

  try {
    if (row.transcriptVtt == null) {
      const duration = evaluateBroadcastDuration(
        row.actualStartedAt,
        row.actualEndedAt
      );
      if (!duration.ok) {
        await db.liveRecording.updateMany({
          where: { id: row.id, transcriptStatus: "processing" },
          data: {
            transcriptStatus: "skipped",
            transcriptError: duration.reason,
            transcriptDurationSec: duration.seconds,
            transcriptNextAttemptAt: null,
          },
        });
        return { ok: true, message: duration.reason ?? "Skipped." };
      }

      await db.liveRecording.updateMany({
        where: { id: row.id, transcriptStatus: "processing" },
        data: { transcriptDurationSec: duration.seconds },
      });

      let audioPath = row.transcriptAudioPath;
      if (!audioPath) {
        const youtubeUrl = `https://www.youtube.com/watch?v=${row.youtubeVideoId}`;
        console.log(
          `[live-transcription] ${row.id}: downloading YouTube VOD ${row.youtubeVideoId}`
        );
        audioPath = await downloadVideoToGcs(youtubeUrl, row.id, row.wpShowId);
        const saved = await db.liveRecording.updateMany({
          where: { id: row.id, transcriptStatus: "processing" },
          data: { transcriptAudioPath: audioPath },
        });
        if (saved.count !== 1) {
          return { ok: true, message: "Lost the scan lease during download." };
        }
        await extendLease(row.id);
      }

      if (!(await stillProcessing(row.id))) {
        return { ok: true, message: "Lost the scan lease before transcription." };
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
      });
      const utterances: MarkUtterance[] = transcription.segments
        .filter((segment) => segment.text?.trim())
        .map((segment) => ({
          start: segment.start,
          end: segment.end,
          text: segment.text.trim(),
        }));
      const saved = await db.liveRecording.updateMany({
        where: { id: row.id, transcriptStatus: "processing" },
        data: {
          transcriptVtt: formatTranscriptAsVtt(transcription.segments),
          transcriptUtterances: asJson(utterances),
          transcriptNextAttemptAt: new Date(Date.now() + TRANSCRIPT_STALE_MS),
        },
      });
      if (saved.count !== 1) {
        return { ok: true, message: "Lost the scan lease during transcription." };
      }
    }

    const fresh = await db.liveRecording.findUnique({ where: { id: row.id } });
    if (!fresh || fresh.transcriptStatus !== "processing") {
      return { ok: true, message: "Lost the scan lease before sending marks." };
    }

    const marks = detectMarks(readUtterances(fresh.transcriptUtterances));
    await db.liveRecording.updateMany({
      where: { id: fresh.id, transcriptStatus: "processing" },
      data: { transcriptMarks: asJson(marks) },
    });

    if (marks.length === 0) {
      await db.liveRecording.updateMany({
        where: { id: fresh.id, transcriptStatus: "processing" },
        data: {
          transcriptStatus: "completed",
          transcriptError: null,
          transcriptNextAttemptAt: null,
          transcriptScannedAt: new Date(),
          transcriptMarksResponse: Prisma.DbNull,
        },
      });
      console.log(`[live-transcription] ${fresh.id}: scanned, no marks`);
      return { ok: true, message: "Scanned. No marks to send." };
    }

    const posted = await postLiveMarks({
      wpShowId: fresh.wpShowId,
      youtubeVideoId: fresh.youtubeVideoId,
      marks,
    });
    if (!(await stillProcessing(fresh.id))) {
      return { ok: true, message: "Lost the scan lease after the website call." };
    }

    if (!posted.ok && posted.kind === "website_not_ready") {
      const plan = planWebsiteNotReady(new Date(), fresh.transcriptAttempts);
      await db.liveRecording.updateMany({
        where: { id: fresh.id, transcriptStatus: "processing" },
        data: plan,
      });
      console.log(`[live-transcription] ${fresh.id}: website route not ready`);
      return { ok: true, message: plan.transcriptError ?? "Website not ready." };
    }

    if (!posted.ok && posted.kind === "config") {
      const plan = planConfigError(fresh.transcriptAttempts, posted.message);
      await db.liveRecording.updateMany({
        where: { id: fresh.id, transcriptStatus: "processing" },
        data: plan,
      });
      console.error(`[live-transcription] ${fresh.id}: ${posted.message}`);
      return { ok: false, message: plan.transcriptError ?? posted.message };
    }

    if (!posted.ok) {
      throw new Error(posted.message);
    }

    await db.liveRecording.updateMany({
      where: { id: fresh.id, transcriptStatus: "processing" },
      data: {
        transcriptStatus: "completed",
        transcriptError: null,
        transcriptNextAttemptAt: null,
        transcriptScannedAt: new Date(),
        transcriptMarksResponse: asJson(posted.response),
      },
    });
    console.log(
      `[live-transcription] ${fresh.id}: sent ${marks.length} mark(s), stored ${posted.response.stored}`
    );
    return {
      ok: true,
      message: `Sent ${marks.length} mark(s). Website stored ${posted.response.stored}.`,
    };
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : "Live transcription failed"
    ).slice(0, 2000);
    console.error(`[live-transcription] ${row.id} failed:`, error);
    const current = await db.liveRecording.findUnique({
      where: { id: row.id },
      select: { transcriptStatus: true, transcriptAttempts: true },
    });
    if (!current || current.transcriptStatus !== "processing") {
      return { ok: false, message };
    }
    const plan = planTranscriptFailure(
      new Date(),
      current.transcriptAttempts + 1,
      message
    );
    await db.liveRecording.updateMany({
      where: { id: row.id, transcriptStatus: "processing" },
      data: plan,
    });
    return { ok: false, message: plan.transcriptError ?? message };
  }
}
