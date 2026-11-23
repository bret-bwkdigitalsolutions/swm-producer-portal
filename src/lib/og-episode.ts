/**
 * The OG is the members-only video section on Your Dark Companion.
 * It is not the private-podcast "premium" flag: those episodes still go to
 * YouTube (unlisted) and that show's premium Transistor feed. An OG episode
 * is stored as swm_premium_content, played from a Vimeo URL Ashlea already
 * locked down, and also published to a separate private OG podcast.
 */

export const OG_WP_SHOW_ID = 21;
export const OG_PREMIUM_SECTION = "og";

/** Always included for an OG job. YouTube and the public podcast are not. */
export const OG_DISTRIBUTION_PLATFORMS = ["website", "transistor"] as const;

export const OG_TRANSISTOR_SHOW_MISSING =
  "The OG has no private Transistor show configured. Create a private podcast in the Transistor dashboard, then save its numeric show ID or slug under Admin > Shows for Your Dark Companion.";

export const OG_VIMEO_TOKEN_MISSING =
  "No Vimeo access token is stored for Your Dark Companion. Add a personal access token (scopes public, private, edit, video_files) under Admin > Credentials for that show.";

/**
 * Transistor cannot create a show via the API. The id saved in admin is
 * either the numeric id from GET /v1/shows or the show slug. Empty clears it.
 */
export function parseOgTransistorShowId(
  raw: string | null | undefined
): { ok: true; id: string | null } | { ok: false; message: string } {
  const value = (raw ?? "").trim();
  if (!value) return { ok: true, id: null };
  if (/^\d{1,15}$/.test(value)) return { ok: true, id: value };
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value)) return { ok: true, id: value };
  return {
    ok: false,
    message: "Enter the private podcast's numeric show ID or slug, not a dashboard URL.",
  };
}

/**
 * Future dates are scheduled. A missing date, or one that is already in the
 * past, publishes now. Transistor rejects a scheduled status with a past
 * published_at, so a past date must not be sent as a schedule.
 */
export function transistorPublishSchedule(
  scheduleMode: unknown,
  scheduledAt: unknown,
  nowMs: number = Date.now()
): string | undefined {
  if (scheduleMode !== "schedule") return undefined;
  if (typeof scheduledAt !== "string" || !scheduledAt.trim()) return undefined;
  const when = Date.parse(scheduledAt);
  if (!Number.isFinite(when) || when <= nowMs) return undefined;
  return scheduledAt;
}

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
const JOB_DETAIL_METADATA_OMIT = ["ogVimeoMediaUrl", "ogVimeoUrl"] as const;

export function metadataForJobDetail(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const copy = { ...metadata };
  for (const key of JOB_DETAIL_METADATA_OMIT) {
    delete copy[key];
  }
  return copy;
}
