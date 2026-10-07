import {
  MARK_DEDUPE_SECONDS,
  MARK_LEAD_SECONDS,
  MARK_QUOTE_MAX_CHARS,
  MARK_QUOTE_UTTERANCES,
} from "./constants";
import type { LiveMark } from "./payload";

export interface MarkUtterance {
  start: number;
  end: number;
  text: string;
}

/**
 * A cue is an imperative "mark that", "mark it", or "mark this" that is the
 * whole utterance or the last clause of a sentence, optionally after one or
 * two short interjections ("Okay, mark it!"). Anything after the phrase —
 * "down", "with a bar graph", "he went" — rejects it. "Mark" as a name
 * ("Mark said that", "Marky Mark") never matches because the clause is not
 * exactly the phrase.
 */
const CUE_PHRASE = /^mark\s+(that|it|this)$/i;
const INTERJECTION =
  /^(?:okay|ok|alright|all right|hey|yo|yeah|yes|yep|ya|so|and|well|now|please)$/i;

function normalize(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** The spoken cue phrase, or null when this utterance is not a mark. */
export function utteranceCue(text: string): string | null {
  const normalized = normalize(text);
  if (!normalized) return null;
  const sentences = normalized.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const cue = clauseCue(sentence);
    if (cue) return cue;
  }
  return null;
}

function clauseCue(sentence: string): string | null {
  const core = sentence.replace(/[.!?…]+$/g, "").trim();
  if (!core) return null;
  const parts = core
    .split(/\s*(?:,|;|:|\u2014|\u2013)\s*|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1].replace(/\s+/g, " ");
  if (!CUE_PHRASE.test(last)) return null;
  const lead = parts.slice(0, -1);
  if (lead.length > 2) return null;
  if (!lead.every((part) => INTERJECTION.test(part))) return null;
  return last;
}

function quoteBefore(utterances: MarkUtterance[], index: number): string {
  const start = Math.max(0, index - MARK_QUOTE_UTTERANCES);
  const text = utterances
    .slice(start, index)
    .map((utterance) => utterance.text.trim())
    .filter(Boolean)
    .join(" ");
  if (text.length <= MARK_QUOTE_MAX_CHARS) return text;
  const tail = text.slice(text.length - MARK_QUOTE_MAX_CHARS).trimStart();
  const space = tail.search(/\s/);
  if (space > 0 && space < 40) return tail.slice(space + 1);
  return tail;
}

/**
 * Find mark cues. `seconds` is the cue start minus 10 (never negative).
 * `quote` is the previous one or two utterances, capped at 280 characters.
 * A cue within 30 seconds of an already-kept cue is dropped.
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
  return hits.map((hit) => ({
    seconds: Math.max(0, Math.floor(hit.start - MARK_LEAD_SECONDS)),
    quote: quoteBefore(ordered, hit.index),
    cue: hit.cue,
  }));
}
