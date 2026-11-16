/**
 * The OG is the members-only video section on Your Dark Companion.
 * It is not the private-podcast "premium" flag: those episodes still go to
 * YouTube (unlisted) and a private Transistor show. An OG episode is website
 * only, uploaded to Vimeo, and stored as swm_premium_content.
 */

export const OG_WP_SHOW_ID = 21;
export const OG_PREMIUM_SECTION = "og";

export function showOffersOg(show: { id: string | number; title: string }): boolean {
  if (String(show.id) === String(OG_WP_SHOW_ID)) return true;
  return show.title.trim().toLowerCase() === "your dark companion";
}

export function isOgDistribution(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as { premiumSection?: unknown }).premiumSection === OG_PREMIUM_SECTION;
}

/**
 * Fields that stay on the server. ogVimeoMediaUrl contains the Vimeo privacy
 * hash, so the job detail page must not receive it.
 */
const JOB_DETAIL_METADATA_OMIT = ["ogVimeoMediaUrl"] as const;

export function metadataForJobDetail(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const copy = { ...metadata };
  for (const key of JOB_DETAIL_METADATA_OMIT) {
    delete copy[key];
  }
  return copy;
}
