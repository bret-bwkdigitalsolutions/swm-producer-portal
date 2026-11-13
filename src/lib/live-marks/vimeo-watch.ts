import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueSideJob } from "@/lib/jobs/job-queue";
import { transcribeAudioBytes } from "@/lib/transcription";
import {
  LIVE_DEEPGRAM_TIMEOUT_MS,
  LIVE_SCAN_LOCK_CLASS,
  LIVE_SCAN_LOCK_KEY,
  MARK_CUE_KEYTERMS,
  MAX_BROADCAST_SECONDS,
} from "./constants";
import { detectMarks } from "./matcher";
import {
  isLiveTranscriptionEnabled,
  liveTranscriptionDailyCap,
  startOfUtcDay,
} from "./retry";
import { captureHlsAudio, probeHlsEdgeSeconds } from "./vimeo-audio";
import { readVimeoLiveEvent, type VimeoLiveReading } from "./vimeo-client";
import {
  buildVimeoLiveMarkPayload,
  parseVimeoLiveEvents,
  redactSecrets,
  utterancesAtStreamEdge,
  vimeoFailureDisposition,
  vimeoLiveReferrer,
  vimeoMarkIdentity,
  vimeoPaidWindowAllowed,
  vimeoVideoKey,
  type VimeoLiveEventConfig,
  type VimeoLiveMarkPayload,
} from "./vimeo-events";
import { postLiveMarksJson } from "./website";

const EDGE_SECONDS = 30;
const LEASE_MS = 4 * 60 * 1000;
const ARCHIVE_LEASE_MS = 50 * 60 * 1000;
const ARCHIVE_CAPTURE_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_WATCH_MS = 4 * 60 * 60 * 1000;
const LIVE_CAPTURE_TIMEOUT_MS = 90_000;
const LIVE_WINDOW_DEEPGRAM_MS = 60_000;

export interface VimeoScanSummary {
  disabled: boolean;
  watching: string[];
  archived: string[];
  idle: string[];
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message);
}

/**
 * One cron tick. No-ops when LIVE_TRANSCRIPTION_ENABLED is off, the same
 * switch as the YouTube archive scan. A live event starts one background
 * watcher. A finished event whose current video has not been scanned starts
 * one archive rescan. Both are idempotent across restarts via the lease and
 * the posted-mark rows.
 */
export async function queueVimeoLiveMarks(): Promise<VimeoScanSummary> {
  if (!isLiveTranscriptionEnabled()) {
    return { disabled: true, watching: [], archived: [], idle: [] };
  }

  const summary: VimeoScanSummary = {
    disabled: false,
    watching: [],
    archived: [],
    idle: [],
  };

  for (const event of parseVimeoLiveEvents()) {
    try {
      const reading = await readVimeoLiveEvent(event);
      const video = reading.snapshot.videoId ?? "none";
      console.log(
        `[vimeo-marks] ${event.eventId} status=${reading.snapshot.status} video=${video} hls=${reading.hls ? "yes" : "no"} auth=${reading.auth}`
      );
      if (reading.snapshot.status === "streaming") {
        const token = await claim(event, reading.snapshot.videoId, "live");
        if (!token) {
          summary.idle.push(event.eventId);
          continue;
        }
        summary.watching.push(event.eventId);
        enqueueSideJob(`vimeo-live:${event.eventId}`, () =>
          withLease(event.eventId, token, () => watchLive(event, token))
        );
      } else if (reading.snapshot.status === "done" && reading.snapshot.videoId) {
        const videoId = reading.snapshot.videoId;
        const token = await claim(event, videoId, "archive");
        if (token) {
          summary.archived.push(event.eventId);
          enqueueSideJob(`vimeo-archive:${event.eventId}`, () =>
            withLease(event.eventId, token, () => scanArchive(event, token))
          );
          continue;
        }
        const pending = await db.vimeoLiveMarkPost.count({
          where: { eventId: event.eventId, status: "pending" },
        });
        if (pending > 0) {
          const flushToken = await claim(event, videoId, "flush");
          if (flushToken) {
            summary.archived.push(event.eventId);
            enqueueSideJob(`vimeo-flush:${event.eventId}`, () =>
              withLease(event.eventId, flushToken, async () => {
                const flushed = await flushPending(event, () =>
                  renew(event.eventId, flushToken, LEASE_MS)
                );
                if (flushed === "stop" || flushed === "terminal") {
                  await recordError(
                    event.eventId,
                    flushToken,
                    new Error(
                      flushed === "terminal"
                        ? "Website rejected the Vimeo mark payload (HTTP 400 or 422). Not retrying."
                        : "Website rejected the Vimeo mark with a configuration error."
                    )
                  );
                }
              })
            );
            continue;
          }
        }
        summary.idle.push(event.eventId);
      } else {
        summary.idle.push(event.eventId);
      }
    } catch (error) {
      console.error(`[vimeo-marks] ${event.eventId}: ${safe(error)}`);
      summary.idle.push(event.eventId);
    }
  }
  return summary;
}

async function claim(
  event: VimeoLiveEventConfig,
  videoId: string | null,
  mode: "live" | "archive" | "flush"
): Promise<string | null> {
  if ((mode === "archive" || mode === "flush") && !videoId) return null;
  const now = new Date();
  try {
    await db.vimeoLiveWatch.create({
      data: { eventId: event.eventId, showId: event.showId, activeVideoId: videoId },
    });
  } catch {
    // The row already exists. The conditional update below claims it.
  }

  const token = randomUUID();
  const leaseMs = mode === "archive" ? ARCHIVE_LEASE_MS : LEASE_MS;
  const leaseFree = {
    OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
  };
  const result = await db.vimeoLiveWatch.updateMany({
    where: {
      eventId: event.eventId,
      AND: [
        leaseFree,
        ...(mode === "archive"
          ? [
              {
                OR: [
                  { archiveVideoId: null },
                  { NOT: { archiveVideoId: videoId } },
                ],
              },
            ]
          : []),
        ...(mode === "live"
          ? [
              {
                OR: [
                  { liveExhaustedVideoId: null },
                  { NOT: { liveExhaustedVideoId: vimeoVideoKey(videoId) } },
                ],
              },
            ]
          : []),
      ],
    },
    data: {
      showId: event.showId,
      activeVideoId: videoId,
      leaseToken: token,
      leaseUntil: new Date(now.getTime() + leaseMs),
      lastError: null,
      ...(mode === "live" ? { liveExhaustedVideoId: null } : {}),
    },
  });
  return result.count === 1 ? token : null;
}

async function renew(eventId: string, token: string, leaseMs: number): Promise<boolean> {
  const result = await db.vimeoLiveWatch.updateMany({
    where: { eventId, leaseToken: token },
    data: { leaseUntil: new Date(Date.now() + leaseMs) },
  });
  return result.count === 1;
}

async function release(eventId: string, token: string): Promise<void> {
  await db.vimeoLiveWatch.updateMany({
    where: { eventId, leaseToken: token },
    data: { leaseToken: null, leaseUntil: null },
  });
}

async function withLease(
  eventId: string,
  token: string,
  run: () => Promise<void>
): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`[vimeo-marks] ${eventId}: ${safe(error)}`);
    await recordError(eventId, token, error);
  } finally {
    await release(eventId, token);
  }
}

async function recordError(
  eventId: string,
  token: string,
  error: unknown
): Promise<void> {
  await db.vimeoLiveWatch.updateMany({
    where: { eventId, leaseToken: token },
    data: { lastError: safe(error) },
  });
}

async function watchLive(
  event: VimeoLiveEventConfig,
  token: string
): Promise<void> {
  const started = Date.now();
  let videoId: string | null = null;
  let stopReason: "timeout" | "stop" = "timeout";
  while (Date.now() - started < MAX_WATCH_MS) {
    if (!isLiveTranscriptionEnabled()) {
      stopReason = "stop";
      break;
    }
    if (!(await renew(event.eventId, token, LEASE_MS))) {
      stopReason = "stop";
      break;
    }
    const reading = await readVimeoLiveEvent(event);
    videoId = reading.snapshot.videoId;
    await rememberReading(event.eventId, token, reading);
    if (reading.snapshot.status === "done") {
      stopReason = "stop";
      await scanArchive(event, token);
      break;
    }
    if (reading.snapshot.status !== "streaming" || !reading.hls) {
      await sleep(10_000);
      continue;
    }
    try {
      const outcome = await transcribeReading(event, token, reading, {
        seconds: EDGE_SECONDS,
        seekStart: false,
        timeoutMs: LIVE_CAPTURE_TIMEOUT_MS,
        deepgramMs: LIVE_WINDOW_DEEPGRAM_MS,
        leaseMs: LEASE_MS,
        fromStart: false,
      });
      if (
        outcome === "config" ||
        outcome === "lost" ||
        outcome === "contract" ||
        outcome === "capped"
      ) {
        stopReason = "stop";
        break;
      }
    } catch (error) {
      console.error(
        `[vimeo-marks] ${event.eventId} live window: ${safe(error)}`
      );
      await recordError(event.eventId, token, error);
      await sleep(5_000);
    }
  }
  if (stopReason === "timeout") {
    await markWatchExhausted(event.eventId, token, videoId);
  }
}

async function scanArchive(
  event: VimeoLiveEventConfig,
  token: string
): Promise<void> {
  if (!(await renew(event.eventId, token, ARCHIVE_LEASE_MS))) return;
  const reading = await readVimeoLiveEvent(event);
  await rememberReading(event.eventId, token, reading);
  const videoId = reading.snapshot.videoId;
  if (!videoId || !reading.hls) {
    await recordError(
      event.eventId,
      token,
      new Error("Vimeo archive has no playable HLS audio yet.")
    );
    return;
  }
  if (reading.snapshot.status === "streaming") return;
  const outcome = await transcribeReading(event, token, reading, {
    seconds: MAX_BROADCAST_SECONDS,
    seekStart: true,
    timeoutMs: ARCHIVE_CAPTURE_TIMEOUT_MS,
    deepgramMs: LIVE_DEEPGRAM_TIMEOUT_MS,
    leaseMs: ARCHIVE_LEASE_MS,
    fromStart: true,
  });
  if (outcome !== "ok" && outcome !== "contract") return;
  await db.vimeoLiveWatch.updateMany({
    where: { eventId: event.eventId, leaseToken: token },
    data: {
      archiveVideoId: videoId,
      archiveScannedAt: new Date(),
      ...(outcome === "ok" ? { lastError: null } : {}),
    },
  });
  console.log(`[vimeo-marks] ${event.eventId} archive scanned video=${videoId}`);
}

async function rememberReading(
  eventId: string,
  token: string,
  reading: VimeoLiveReading
): Promise<void> {
  const started = reading.hls?.streamStartedAt;
  await db.vimeoLiveWatch.updateMany({
    where: { eventId, leaseToken: token },
    data: {
      ...(reading.snapshot.videoId ? { activeVideoId: reading.snapshot.videoId } : {}),
      ...(started ? { streamStartedAt: new Date(started * 1000) } : {}),
    },
  });
}

async function markWatchExhausted(
  eventId: string,
  token: string,
  videoId: string | null
): Promise<void> {
  await db.vimeoLiveWatch.updateMany({
    where: { eventId, leaseToken: token },
    data: { liveExhaustedVideoId: vimeoVideoKey(videoId) },
  });
  console.log(
    `[vimeo-marks] ${eventId} live watch finished its window for video=${vimeoVideoKey(videoId) || "unknown"}`
  );
}

/**
 * One paid Deepgram window, counted with the YouTube scans against
 * LIVE_TRANSCRIPTION_DAILY_CAP. The advisory lock is the same one the
 * YouTube claim uses, so the two paths cannot both slip past the cap.
 */
async function reservePaidWindow(eventId: string): Promise<boolean> {
  const now = new Date();
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock($1::int, $2::int)",
      LIVE_SCAN_LOCK_CLASS,
      LIVE_SCAN_LOCK_KEY
    );
    const cap = liveTranscriptionDailyCap();
    const used = await tx.liveScanPaidClaim.count({
      where: { claimedAt: { gte: startOfUtcDay(now) } },
    });
    if (!vimeoPaidWindowAllowed(used, cap)) return false;
    await tx.liveScanPaidClaim.create({
      data: { liveRecordingId: `vimeo:${eventId}`, claimedAt: now },
    });
    return true;
  });
}

async function transcribeReading(
  event: VimeoLiveEventConfig,
  token: string,
  reading: VimeoLiveReading,
  options: {
    seconds: number;
    seekStart: boolean;
    timeoutMs: number;
    deepgramMs: number;
    leaseMs: number;
    fromStart: boolean;
  }
): Promise<"ok" | "config" | "contract" | "capped" | "lost" | "empty"> {
  if (!reading.hls) return "empty";
  const videoId = reading.snapshot.videoId ?? "unknown";
  const referer = vimeoLiveReferrer();
  const keep = () => renew(event.eventId, token, options.leaseMs);
  if (!(await keep())) return "lost";
  const flushed = await flushPending(event, keep);
  if (flushed === "terminal") {
    await recordError(
      event.eventId,
      token,
      new Error("Website rejected the Vimeo mark payload (HTTP 400 or 422). Not retrying.")
    );
    return "contract";
  }
  if (flushed === "stop") {
    await recordError(
      event.eventId,
      token,
      new Error("Website rejected the Vimeo mark with a configuration error.")
    );
    return "config";
  }
  if (!(await reservePaidWindow(event.eventId))) {
    console.log(
      `[vimeo-marks] ${event.eventId} daily cap reached. Not starting another window.`
    );
    return "capped";
  }

  const edge = options.fromStart
    ? 0
    : await probeHlsEdgeSeconds(reading.hls.url, referer);
  const audio = await captureHlsAudio({
    url: reading.hls.url,
    referer,
    seconds: options.seconds,
    seekStart: options.seekStart,
    timeoutMs: options.timeoutMs,
  });
  if (!(await keep())) return "lost";
  const transcript = await transcribeAudioBytes(audio, "audio/mpeg", {
    wpShowId: event.showId,
    extraKeyterms: [...MARK_CUE_KEYTERMS],
    timeoutMs: options.deepgramMs,
  });
  const marks = detectMarks(
    utterancesAtStreamEdge(
      transcript.segments
        .filter((segment) => segment.text?.trim())
        .map((segment) => ({
          start: segment.start,
          end: segment.end,
          text: segment.text.trim(),
        })),
      edge
    )
  );
  for (const mark of marks) {
    const outcome = await ensurePosted(event, videoId, mark, keep);
    if (outcome === "terminal") {
      await recordError(
        event.eventId,
        token,
        new Error("Website rejected the Vimeo mark payload (HTTP 400 or 422). Not retrying.")
      );
      return "contract";
    }
    if (outcome === "stop") {
      await recordError(
        event.eventId,
        token,
        new Error("Website rejected the Vimeo mark with a configuration error.")
      );
      return "config";
    }
  }
  return "ok";
}

async function flushPending(
  event: VimeoLiveEventConfig,
  keep: () => Promise<boolean>
): Promise<"terminal" | "stop" | null> {
  const pending = await db.vimeoLiveMarkPost.findMany({
    where: { eventId: event.eventId, status: "pending" },
    orderBy: { offsetSeconds: "asc" },
    take: 20,
  });
  for (const row of pending) {
    const payload = readPayload(row.payload);
    if (!payload) continue;
    const outcome = await sendPayload(row.id, payload, keep);
    if (outcome === "terminal" || outcome === "stop") return outcome;
  }
  return null;
}

async function ensurePosted(
  event: VimeoLiveEventConfig,
  videoId: string,
  mark: { seconds: number; quote: string; cue: string },
  keep: () => Promise<boolean>
): Promise<"ok" | "later" | "stop" | "terminal"> {
  const payload = buildVimeoLiveMarkPayload({
    showId: event.showId,
    eventId: event.eventId,
    videoId: videoId === "unknown" ? null : videoId,
    mark,
  });
  const identity = vimeoMarkIdentity(event.eventId, mark.seconds);
  const existing = await db.vimeoLiveMarkPost.findUnique({
    where: { eventId_dedupeBucket: identity },
  });
  if (existing?.status === "posted" || existing?.status === "contract_error") {
    return "ok";
  }
  if (existing) return sendPayload(existing.id, payload, keep);

  try {
    const created = await db.vimeoLiveMarkPost.create({
      data: {
        eventId: identity.eventId,
        videoId,
        dedupeBucket: identity.dedupeBucket,
        offsetSeconds: mark.seconds,
        cueText: payload.cue_text,
        payload: asJson(payload),
        status: "pending",
      },
    });
    return sendPayload(created.id, payload, keep);
  } catch (error) {
    console.error(`[vimeo-marks] ${event.eventId} store: ${safe(error)}`);
    return "later";
  }
}

async function sendPayload(
  id: string,
  payload: VimeoLiveMarkPayload,
  keep: () => Promise<boolean>
): Promise<"ok" | "later" | "stop" | "terminal"> {
  let result = await postLiveMarksJson(payload);
  if (!result.ok && result.kind === "overlap") {
    if (!(await keep())) return "later";
    await sleep(35_000);
    result = await postLiveMarksJson(payload);
  }
  if (result.ok) {
    await db.vimeoLiveMarkPost.update({
      where: { id },
      data: { status: "posted" },
    });
    console.log(
      `[vimeo-marks] posted event=${payload.vimeo_event_id} video=${payload.vimeo_video_id ?? "none"} offset=${payload.offset_seconds}`
    );
    return "ok";
  }
  const disposition = vimeoFailureDisposition(result.kind);
  console.log(
    `[vimeo-marks] post ${result.kind} disposition=${disposition} event=${payload.vimeo_event_id} offset=${payload.offset_seconds}`
  );
  if (disposition === "terminal") {
    await db.vimeoLiveMarkPost.update({
      where: { id },
      data: { status: "contract_error" },
    });
    return "terminal";
  }
  if (disposition === "stop") return "stop";
  return "later";
}

function readPayload(value: unknown): VimeoLiveMarkPayload | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.platform !== "vimeo") return null;
  if (typeof row.vimeo_event_id !== "string") return null;
  if (typeof row.offset_seconds !== "number") return null;
  if (typeof row.cue_text !== "string") return null;
  if (typeof row.show_id !== "number") return null;
  return row as unknown as VimeoLiveMarkPayload;
}
