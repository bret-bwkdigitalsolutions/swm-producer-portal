import {
  MARK_DEDUPE_SECONDS,
  MARK_LEAD_SECONDS,
  MARK_QUOTE_UTTERANCES,
  MAX_MARKS_PER_POST,
} from "./constants";
import { sanitizeLiveMark, type LiveMark } from "./payload";

export interface MarkUtterance {
  start: number;
  end: number;
  text: string;
}

/**
 * Imperative "mark that|it|this", then either the end of the text, real
 * punctuation, or one short tail: "one", "right there", "real quick",
 * "please", "now". A following word outside that list ("guy", "down",
 * "was", "zero", "Friday") rejects the cue.
 *
 * Longer tails are listed first so "right there" is not cut down to a
 * shorter alternative.
 */
const CUE_RE =
  /\bmark\s+(?:that|it|this)(?:\s+(?:right there|real quick|one|please|now))?(?=\s*(?:[.!?…,;:\u2014\u2013]+|$))/i;

function normalize(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** The spoken cue, e.g. "Mark that" or "mark that one", or null. */
export function utteranceCue(text: string): string | null {
  const normalized = normalize(text);
  if (!normalized) return null;
  const match = normalized.match(CUE_RE);
  if (!match) return null;
  return match[0].replace(/\s+/g, " ").trim();
}

function quoteBefore(utterances: MarkUtterance[], index: number): string {
  const start = Math.max(0, index - MARK_QUOTE_UTTERANCES);
  return utterances
    .slice(start, index)
    .map((utterance) => utterance.text.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Find mark cues. `seconds` is an integer, the cue start minus 10, clamped
 * to 0–86400. `quote` is the previous one or two utterances, plain text,
 * at most 280 characters. A cue within 30 seconds of an already-kept cue
 * is dropped. At most 50 marks are kept, the earliest after that dedupe.
 */
export function detectMarks(utterances: MarkUtterance[]): LiveMark[] {
  const ordered = [...utterances].sort(
    (a, b) => a.start - b.start || a.end - b.end
  );
  const hits: Array<{ index: number; cue: string; start: number }> = [];
  for (let index = 0; index < ordered.length; index++) {
    const cue = utteranceCue(ordered[index].text);
    if (!cue) continue;
    const start = Number.isFinite(ordered[index].start) ? ordered[index].start : 0;
    const previous = hits[hits.length - 1];
    if (previous && start - previous.start <= MARK_DEDUPE_SECONDS) continue;
    hits.push({ index, cue, start });
  }
  return hits.slice(0, MAX_MARKS_PER_POST).map((hit) =>
    sanitizeLiveMark({
      seconds: hit.start - MARK_LEAD_SECONDS,
      quote: quoteBefore(ordered, hit.index),
      cue: hit.cue,
    })
  );
}
