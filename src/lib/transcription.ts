import "server-only";

import { applyAsrCorrections } from "@/lib/asr-corrections";
import { generateSignedDownloadUrl } from "@/lib/gcs";
import {
  buildDeepgramListenQuery,
  keytermsForShow,
  keytermsFromHosts,
} from "@/lib/keyterms";

export interface TranscriptSegment {
  start: number;   // seconds
  end: number;     // seconds
  text: string;
  speaker?: number; // speaker ID from diarization
}

export interface TranscriptionResult {
  fullText: string;
  segments: TranscriptSegment[];
  language: string;
  duration: number; // total audio duration in seconds
}

export interface TranscribeOptions {
  /**
   * BCP-47 code (e.g. "es") to force the transcription language. When set,
   * Deepgram transcribes in that language instead of auto-detecting — used
   * for shows configured to a specific language (e.g. ¡Al Maximo! in Spanish).
   * When omitted, language is auto-detected (default for most shows).
   */
  forceLanguage?: string;
  /** Show id used to pick the Deepgram keyterm list. */
  wpShowId?: number;
  /**
   * Extra phrases merged into the show list. Usually `ShowMetadata.hosts`.
   * Pass either the raw comma-separated hosts string via `hosts` or phrases
   * already split via `extraKeyterms`.
   */
  extraKeyterms?: string[];
  /** Comma-separated host names from ShowMetadata. */
  hosts?: string | null;
}

function resolveTranscribeOptions(
  options?: string | TranscribeOptions
): TranscribeOptions {
  if (typeof options === "string") return { forceLanguage: options };
  return options ?? {};
}

/**
 * Transcribe an audio file stored in GCS using Deepgram Nova-3.
 *
 * The second argument is either a BCP-47 language code (legacy) or
 * {@link TranscribeOptions}. Show keyterms are sent as repeated `keyterm`
 * params. The returned transcript has the reviewed ASR dictionary applied
 * to the full text and to each segment before the caller saves or publishes it.
 * Show-scoped rules use `wpShowId`; unscoped rules always run.
 */
export async function transcribeAudio(
  gcsAudioPath: string,
  options?: string | TranscribeOptions
): Promise<TranscriptionResult> {
  const { forceLanguage, wpShowId, extraKeyterms, hosts } =
    resolveTranscribeOptions(options);

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not set.");
  }

  const downloadUrl = await generateSignedDownloadUrl(gcsAudioPath);
  const keyterms = keytermsForShow(wpShowId, [
    ...keytermsFromHosts(hosts),
    ...(extraKeyterms ?? []),
  ]);

  console.log(
    `[transcription] Transcribing: ${gcsAudioPath}` +
      (forceLanguage ? ` (forced language: ${forceLanguage})` : " (auto-detect)") +
      ` (${keyterms.length} keyterms` +
      (wpShowId != null ? `, show ${wpShowId}` : "") +
      ")"
  );

  // Deepgram takes either an explicit `language` OR `detect_language`, not both.
  // Keyterms must be repeated params — see buildDeepgramListenQuery.
  const query = buildDeepgramListenQuery({ forceLanguage, keyterms });

  const response = await fetch(
    "https://api.deepgram.com/v1/listen?" + query.toString(),
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: downloadUrl }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Deepgram API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const result = data.results?.channels?.[0]?.alternatives?.[0];

  if (!result) {
    throw new Error("Deepgram returned no transcription results.");
  }

  const segments: TranscriptSegment[] = (result.paragraphs?.paragraphs ?? []).map(
    (p: any) => ({
      start: p.start,
      end: p.end,
      // Correct names before anything persists this text.
      text: applyAsrCorrections(
        p.sentences?.map((s: any) => s.text).join(" ") ?? "",
        wpShowId
      ),
      speaker: p.speaker,
    })
  );

  // When we forced a language, report that (Deepgram omits detected_language in
  // that case); otherwise use the detected value.
  const detectedLanguage =
    forceLanguage ??
    data.results?.channels?.[0]?.detected_language ??
    "en";
  const duration = data.metadata?.duration ?? 0;

  console.log(
    `[transcription] Complete: ${segments.length} segments, language: ${detectedLanguage}, duration: ${Math.round(duration)}s`
  );

  return {
    fullText: applyAsrCorrections(result.transcript ?? "", wpShowId),
    segments,
    language: detectedLanguage,
    duration,
  };
}

/**
 * Format transcript segments as timestamped text for AI analysis.
 */
export function formatTranscriptForAI(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => {
      const timestamp = formatTimestamp(s.start);
      const speaker = s.speaker !== undefined ? `[Speaker ${s.speaker}]` : "";
      return `[${timestamp}] ${speaker} ${s.text}`;
    })
    .join("\n");
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** Format seconds as a WebVTT timestamp: HH:MM:SS.mmm */
function formatVttTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  return (
    `${h.toString().padStart(2, "0")}:` +
    `${m.toString().padStart(2, "0")}:` +
    `${s.toString().padStart(2, "0")}.` +
    `${ms.toString().padStart(3, "0")}`
  );
}

/**
 * Build a valid WebVTT transcript from timestamped segments. The website's
 * "Mark That" scanner parses each cue's START time to place a bookmark, so the
 * cue text must be the spoken words (no speaker prefixes that could interfere
 * with phrase matching). Segment-level cues are sufficient — word-level is not
 * needed. Returns "" when there are no usable segments (caller then skips the
 * WordPress field entirely).
 */
export function formatTranscriptAsVtt(segments: TranscriptSegment[]): string {
  const cues: string[] = [];
  for (const seg of segments) {
    const text = seg.text?.trim();
    if (!text) continue;
    const start = Number.isFinite(seg.start) ? seg.start : 0;
    // WebVTT requires end > start; nudge degenerate/zero-length cues.
    const end =
      Number.isFinite(seg.end) && seg.end > start ? seg.end : start + 2;
    cues.push(`${formatVttTime(start)} --> ${formatVttTime(end)}\n${text}`);
  }
  if (cues.length === 0) return "";
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/**
 * Format transcript segments as speaker-labeled plain text for WordPress display.
 * Groups consecutive segments by the same speaker into single paragraphs.
 * Separates speaker turns with blank lines.
 */
export function formatTranscriptForDisplay(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return "";

  const turns: { speaker: string; text: string }[] = [];
  let currentSpeaker: number | undefined;
  let currentText = "";

  for (const seg of segments) {
    if (seg.speaker !== currentSpeaker && currentText) {
      turns.push({
        speaker: currentSpeaker !== undefined ? `Speaker ${currentSpeaker + 1}` : "",
        text: currentText.trim(),
      });
      currentText = "";
    }
    currentSpeaker = seg.speaker;
    currentText += (currentText ? " " : "") + seg.text;
  }

  // Push final turn
  if (currentText) {
    turns.push({
      speaker: currentSpeaker !== undefined ? `Speaker ${currentSpeaker + 1}` : "",
      text: currentText.trim(),
    });
  }

  return turns
    .map((t) => (t.speaker ? `${t.speaker}: ${t.text}` : t.text))
    .join("\n\n");
}
