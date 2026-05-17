export type MetadataLanguage = "en" | "es";

export interface ProposedMetadata {
  title: string;
  excerpt: string;
  seoDescription: string;
  seoKeyphrase: string;
}

const LANGUAGE_INSTRUCTIONS: Record<MetadataLanguage, string> = {
  en: "Write all four fields in English.",
  es: "Escribe los cuatro campos en español. Usa terminología natural para hispanohablantes.",
};

/**
 * Build the Claude prompt that proposes a title/excerpt/SEO description/
 * focus keyphrase from a blog body. Pure function so it's testable without
 * mocking Claude.
 *
 * The HTML body is trimmed to ~12k chars; longer than that we keep the
 * head and tail and drop the middle, which preserves the intro hook and
 * closing CTA where titles and excerpts typically draw from.
 */
export function buildMetadataPrompt(
  htmlBody: string,
  language: MetadataLanguage
): string {
  const trimmed = trimMiddle(htmlBody, 12000);
  const languageInstruction = LANGUAGE_INSTRUCTIONS[language];

  return [
    "You are generating SEO metadata for a podcast blog post. Read the post body and produce four pieces of metadata.",
    "",
    "Fields to produce:",
    "- title: a compelling, SEO-friendly headline. If the post already has a strong working title in its first heading, you may use or lightly refine it. Otherwise invent one that captures the post's main hook.",
    "- excerpt: a roughly 30-word summary used on listing pages. Should make a reader want to click. Mention the host/author by name if they introduce themselves.",
    "- seoDescription: a meta description, MAXIMUM 160 characters total (this is a hard limit — count characters, not words). Includes the focus keyphrase naturally.",
    "- seoKeyphrase: a 2-to-4 word focus keyphrase that someone searching for this content would type. Should be high-intent and specific.",
    "",
    languageInstruction,
    "",
    "Return ONLY a single JSON object in this exact shape, with no markdown fence and no commentary:",
    `{"title":"...","excerpt":"...","seoDescription":"...","seoKeyphrase":"..."}`,
    "",
    "Blog post body (HTML):",
    "---",
    trimmed,
    "---",
  ].join("\n");
}

/**
 * Parse Claude's JSON response into a ProposedMetadata object. Tolerates
 * leading/trailing whitespace and an optional markdown code fence (which
 * the prompt instructs against but Claude occasionally adds anyway).
 *
 * Returns null when the response cannot be parsed or is missing fields.
 */
export function parseMetadataResponse(raw: string): ProposedMetadata | null {
  if (!raw) return null;

  // Strip optional markdown fences
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }

  // Pull the first {...} block — defensive against any prose Claude might add
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const excerpt = typeof obj.excerpt === "string" ? obj.excerpt.trim() : "";
  const seoDescription =
    typeof obj.seoDescription === "string" ? obj.seoDescription.trim() : "";
  const seoKeyphrase =
    typeof obj.seoKeyphrase === "string" ? obj.seoKeyphrase.trim() : "";

  if (!title || !excerpt || !seoDescription || !seoKeyphrase) return null;

  return { title, excerpt, seoDescription, seoKeyphrase };
}

function trimMiddle(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const half = Math.floor(maxChars / 2);
  return (
    content.slice(0, half) +
    "\n\n[... middle of post trimmed for brevity ...]\n\n" +
    content.slice(-half)
  );
}
