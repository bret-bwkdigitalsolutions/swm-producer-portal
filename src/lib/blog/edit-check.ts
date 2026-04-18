/**
 * Strip HTML tags to get plain text for diffing.
 * Block-level closing tags are replaced with spaces so adjacent words don't run together.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|h[1-6]|li|div|br|blockquote)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute the length of the longest common subsequence between two strings.
 * Uses a two-row optimization to keep memory O(min(a,b)).
 */
function lcsLength(a: string, b: string): number {
  if (a.length > b.length) [a, b] = [b, a];

  let prev = new Array<number>(a.length + 1).fill(0);
  let curr = new Array<number>(a.length + 1).fill(0);

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      curr[i] =
        a[i - 1] === b[j - 1]
          ? prev[i - 1] + 1
          : Math.max(prev[i], curr[i - 1]);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[a.length];
}

/**
 * Compute the percentage of content that changed between original and edited HTML.
 * Strips HTML tags first so formatting-only changes don't count.
 *
 * Uses an LCS-based metric: changed chars (deletions + insertions) divided by
 * total chars in both strings. This keeps small changes in long texts proportionally
 * small and is more semantically meaningful than raw Levenshtein distance.
 *
 * Returns 0-100.
 */
export function computeEditPercentage(
  originalHtml: string | null,
  editedHtml: string
): number {
  const original = stripHtml(originalHtml ?? "");
  const edited = stripHtml(editedHtml);

  if (original === edited) return 0;
  if (original.length === 0) return 100;

  const lcs = lcsLength(original, edited);
  const changed = (original.length - lcs) + (edited.length - lcs);
  const total = original.length + edited.length;
  const pct = Math.round((changed / total) * 100);

  return Math.min(pct, 100);
}

/**
 * Map a percentage to a human-readable label.
 */
export function getEditLabel(percentage: number): string {
  if (percentage === 0) return "No changes";
  if (percentage <= 10) return "Minor edits";
  if (percentage <= 30) return "Moderate edits";
  return "Heavily rewritten";
}
