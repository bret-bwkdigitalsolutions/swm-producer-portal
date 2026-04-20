import "server-only";

import { generateSignedDownloadUrl } from "@/lib/gcs";

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

/**
 * Transcribe an audio file stored in GCS using Deepgram.
 *
 * @param gcsAudioPath - GCS path of the audio file
 * @returns Transcription result with timestamped segments
 */
export async function transcribeAudio(
  gcsAudioPath: string
): Promise<TranscriptionResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not set.");
  }

  const downloadUrl = await generateSignedDownloadUrl(gcsAudioPath);

  console.log(`[transcription] Transcribing: ${gcsAudioPath}`);

  const response = await fetch(
    "https://api.deepgram.com/v1/listen?" +
      new URLSearchParams({
        model: "nova-3",
        smart_format: "true",
        detect_language: "true",
        diarize: "true",
        paragraphs: "true",
        utterances: "true",
      }),
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
      text: p.sentences?.map((s: any) => s.text).join(" ") ?? "",
      speaker: p.speaker,
    })
  );

  const detectedLanguage =
    data.results?.channels?.[0]?.detected_language ?? "en";
  const duration = data.metadata?.duration ?? 0;

  console.log(
    `[transcription] Complete: ${segments.length} segments, language: ${detectedLanguage}, duration: ${Math.round(duration)}s`
  );

  return {
    fullText: result.transcript ?? "",
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
