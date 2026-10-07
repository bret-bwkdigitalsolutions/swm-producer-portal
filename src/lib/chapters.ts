/**
 * Structured episode chapters for the WordPress theme.
 *
 * The producer still edits chapters as text (`HH:MM:SS - Title` plus an
 * optional description line). At publish time we parse that text into
 * `{ name, start, end }` and:
 *   - append an HTML block the current theme can show immediately
 *     (H2 + id + `?t=` seek link; wrapper class `swm-chapters`)
 *   - send the same structure as the `_swm_chapters` meta string so the
 *     website bot can render it (and Clip schema) itself
 *
 * Unparseable text keeps the previous `<h3>Chapters</h3>` + `<br>` body
 * and does not set the meta key, so an odd paste cannot blank the chapter list.
 */

export const SWM_CHAPTERS_META_KEY = "_swm_chapters";

export interface StructuredChapter {
  /** Chapter title. */
  name: string;
  /** Start offset in seconds. */
  start: number;
  /** End offset in seconds. Next chapter's start, or the audio duration for the last chapter. */
  end?: number;
  /** Optional one-sentence description under the heading. */
  description?: string;
  /** HTML id for the H2 anchor. Unique within the episode. */
  id: string;
  /** Relative seek link. The episode player already understands `?t=SECONDS`. */
  seek: string;
}

export interface ChaptersMetaPayload {
  version: 1;
  chapters: StructuredChapter[];
}

export interface RenderedChapters {
  /** HTML appended after the episode description. */
  html: string;
  /**
   * JSON string for post meta `_swm_chapters`. Absent when the text did not
   * parse into at least one chapter.
   */
  structuredJson?: string;
}

const CHAPTER_HEADING =
  /^(?:\[|\()?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:\]|\))?\s*[-–—:]\s+(.+?)\s*$/;

function parseTimestamp(raw: string): number | null {
  const parts = raw.split(":").map((part) => Number(part));
  if (parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    if (m > 59 || s > 59) return null;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    if (s > 59) return null;
    return m * 60 + s;
  }
  return null;
}

function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) return "chapter";
  return /^[0-9]/.test(slug) ? `chapter-${slug}` : slug;
}

function uniqueId(name: string, used: Set<string>): string {
  const base = slugify(name);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  const id = `${base}-${n}`;
  used.add(id);
  return id;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface ParsedHeading {
  start: number;
  name: string;
  descriptionLines: string[];
}

/**
 * Parse producer/AI chapter text. Returns [] when nothing matches, which
 * tells publish to keep the legacy HTML block.
 */
export function parseChapters(
  text: string | undefined | null,
  durationSeconds?: number
): StructuredChapter[] {
  if (!text?.trim()) return [];

  const headings: ParsedHeading[] = [];
  let current: ParsedHeading | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(CHAPTER_HEADING);
    if (match) {
      const start = parseTimestamp(match[1]);
      const name = match[2].trim();
      if (start == null || !name) continue;
      current = { start, name, descriptionLines: [] };
      headings.push(current);
      continue;
    }
    if (current && line) current.descriptionLines.push(line);
  }

  if (headings.length === 0) return [];

  const usedIds = new Set<string>();
  const duration =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
      ? durationSeconds
      : undefined;

  return headings.map((heading, index) => {
    const next = headings[index + 1];
    let end: number | undefined;
    if (next && next.start > heading.start) {
      end = next.start;
    } else if (!next && duration != null && duration > heading.start) {
      end = Math.floor(duration);
    }
    const description = heading.descriptionLines.join(" ").trim();
    const chapter: StructuredChapter = {
      name: heading.name,
      start: heading.start,
      id: uniqueId(heading.name, usedIds),
      seek: `?t=${heading.start}`,
    };
    if (end != null) chapter.end = end;
    if (description) chapter.description = description;
    return chapter;
  });
}

export function chaptersMetaPayload(
  chapters: StructuredChapter[]
): ChaptersMetaPayload {
  return { version: 1, chapters };
}

/** H2 list with anchors and seek links. Empty when there are no chapters. */
export function chaptersToHtml(chapters: StructuredChapter[]): string {
  if (chapters.length === 0) return "";
  const blocks = chapters.map((chapter) => {
    const heading =
      `<h2 id="${escapeHtml(chapter.id)}">` +
      `<a href="${escapeHtml(chapter.seek)}">${escapeHtml(chapter.name)}</a>` +
      `</h2>`;
    if (!chapter.description) return heading;
    return `${heading}\n<p>${escapeHtml(chapter.description)}</p>`;
  });
  return `<div class="swm-chapters">\n${blocks.join("\n")}\n</div>`;
}

/**
 * Build the chapter HTML (and optional meta JSON) for a WordPress episode.
 * Null when the producer left chapters blank — caller appends nothing.
 */
export function renderChaptersForWordPress(
  chaptersText: string | undefined | null,
  durationSeconds?: number
): RenderedChapters | null {
  if (!chaptersText?.trim()) return null;

  const chapters = parseChapters(chaptersText, durationSeconds);
  if (chapters.length === 0) {
    return {
      html: `<h3>Chapters</h3>\n${chaptersText.replace(/\n/g, "<br>")}`,
    };
  }

  return {
    html: chaptersToHtml(chapters),
    structuredJson: JSON.stringify(chaptersMetaPayload(chapters)),
  };
}
