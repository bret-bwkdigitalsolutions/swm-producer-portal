/**
 * Extract a Google Doc ID from a URL or accept a bare ID.
 *
 * Accepted forms:
 *   https://docs.google.com/document/d/{ID}/edit?usp=sharing
 *   https://docs.google.com/document/d/{ID}/edit
 *   https://docs.google.com/document/d/{ID}/view
 *   https://docs.google.com/document/d/{ID}
 *   {ID}                                              (bare, when 25+ chars long)
 *
 * Returns null for unrecognized input.
 */
export function parseGoogleDocUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // URL form: pull the segment after /document/d/
  const match = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // Bare ID form: Google Doc IDs are typically 44 chars but accept any
  // reasonable-length alphanumeric+_- string with no slashes
  if (/^[a-zA-Z0-9_-]{25,}$/.test(trimmed)) return trimmed;

  return null;
}
