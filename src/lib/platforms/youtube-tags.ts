/**
 * YouTube Data API `snippet.tags` rules used by `uploadToYouTube`.
 *
 * The videos resource allows spaces and caps the tags field at 500
 * characters. Commas between tags count. A tag that contains a space is
 * counted as if the API wrapped it in quotes, and those quotes count too
 * (`Foo Baz` is 9, `Foo-Baz` is 7).
 * https://developers.google.com/youtube/v3/docs/videos#snippet.tags
 *
 * The API returns `400 invalidTags` for keywords outside that budget and
 * for characters it rejects (`<`, `>`, quotes, apostrophes). Studio also
 * keeps each tag short; we cap each one at 30 characters.
 */

const TAG_MAX_CHARS = 30;
const TAGS_FIELD_MAX_CHARS = 500;

/** Dashes that should survive as an ASCII hyphen instead of being deleted. */
const UNICODE_DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;

/**
 * Characters YouTube accepts in a keyword: letters (including accents),
 * numbers, spaces, hyphens, underscores, and periods.
 */
const DISALLOWED = /[^\p{L}\p{N} ._-]+/gu;

function cleanTag(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(UNICODE_DASHES, "-")
    .replace(DISALLOWED, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TAG_MAX_CHARS)
    .trim();
}

/** How many characters this tag contributes to the 500-character field. */
function tagWeight(tag: string): number {
  return tag.length + (/\s/.test(tag) ? 2 : 0);
}

/**
 * Drop tags from the end until the comma-separated field fits YouTube's
 * 500-character budget, using the API's quote-and-comma accounting.
 */
function fitTagBudget(tags: string[]): string[] {
  const kept: string[] = [];
  let used = 0;
  for (const tag of tags) {
    const weight = tagWeight(tag);
    const separator = kept.length > 0 ? 1 : 0;
    if (used + separator + weight > TAGS_FIELD_MAX_CHARS) break;
    kept.push(tag);
    used += separator + weight;
  }
  return kept;
}

/**
 * Normalize producer/AI tags before `videos.insert`.
 * Strips characters YouTube rejects, trims, drops empties, dedupes
 * case-insensitively, caps each tag at 30 characters, and keeps the
 * comma-separated field within 500 characters.
 */
export function sanitizeYouTubeTags(
  tags: readonly string[] | null | undefined
): string[] {
  if (!Array.isArray(tags)) return [];

  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = cleanTag(raw);
    if (!tag || !/[\p{L}\p{N}]/u.test(tag)) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(tag);
  }
  return fitTagBudget(cleaned);
}
