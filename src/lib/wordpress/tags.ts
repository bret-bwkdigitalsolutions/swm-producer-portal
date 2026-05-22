import "server-only";

/**
 * REST base for the swm_blog tag taxonomy. The WordPress side registers this
 * taxonomy with `show_in_rest` + this rest_base (see the website handoff for
 * the blog-tags work). If WP registers a different rest_base, change this one
 * constant — every read/write below keys off it.
 */
export const SWM_BLOG_TAG_REST_BASE = "swm_blog_tags";

const WP_API_URL = () => process.env.WP_API_URL!;
const WP_AUTH = () =>
  "Basic " +
  Buffer.from(
    `${process.env.WP_APP_USER}:${process.env.WP_APP_PASSWORD}`
  ).toString("base64");

interface WpTerm {
  id: number;
  name: string;
  slug: string;
}

/**
 * Resolve a list of keyword phrases to WordPress tag term IDs, creating any
 * term that doesn't already exist. Matching is case-insensitive on the term
 * name. Best-effort per phrase: a failure to resolve one keyword logs and is
 * skipped rather than aborting the publish — tags are an enhancement, not a
 * gate.
 */
export async function resolveTagTermIds(phrases: string[]): Promise<number[]> {
  const cleaned = Array.from(
    new Set(phrases.map((p) => p.trim()).filter(Boolean))
  );
  if (cleaned.length === 0) return [];

  const base = `${WP_API_URL()}/${SWM_BLOG_TAG_REST_BASE}`;
  const ids: number[] = [];

  for (const phrase of cleaned) {
    try {
      const id = await findOrCreateTerm(base, phrase);
      if (id != null) ids.push(id);
    } catch (error) {
      console.error(`[blog-tags] Failed to resolve tag "${phrase}":`, error);
    }
  }

  return ids;
}

async function findOrCreateTerm(
  base: string,
  name: string
): Promise<number | null> {
  // Search first — reuse an existing term so we don't create duplicates that
  // differ only by trailing punctuation/case.
  const searchRes = await fetch(
    `${base}?search=${encodeURIComponent(name)}&per_page=100&_fields=id,name,slug`,
    { headers: { Authorization: WP_AUTH() } }
  );
  if (searchRes.ok) {
    const terms = (await searchRes.json()) as WpTerm[];
    const exact = terms.find(
      (t) => t.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (exact) return exact.id;
  }

  // Not found — create it.
  const createRes = await fetch(base, {
    method: "POST",
    headers: {
      Authorization: WP_AUTH(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });

  if (createRes.ok) {
    const term = (await createRes.json()) as WpTerm;
    return term.id;
  }

  // WP returns 400 term_exists with the existing id when a slug collides with
  // a name our search didn't catch — recover that id rather than dropping it.
  if (createRes.status === 400) {
    const body = (await createRes.json()) as {
      code?: string;
      data?: { term_id?: number };
    };
    if (body.code === "term_exists" && body.data?.term_id) {
      return body.data.term_id;
    }
  }

  const errBody = await createRes.text();
  throw new Error(`WP tag create failed (${createRes.status}): ${errBody}`);
}
