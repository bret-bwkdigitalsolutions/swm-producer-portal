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
