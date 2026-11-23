import "server-only";

import { OG_WP_SHOW_ID, showOffersOg } from "@/lib/og-episode";
import { getShow } from "@/lib/wordpress/client";

/**
 * The OG and its Vimeo token belong on Your Dark Companion.
 * Show 21 matches without a WordPress call. Any other id is checked by title.
 */
export async function showCanHostOg(wpShowId: number): Promise<boolean> {
  if (wpShowId === OG_WP_SHOW_ID) return true;
  if (!Number.isInteger(wpShowId) || wpShowId <= 0) return false;
  try {
    const show = await getShow(wpShowId);
    return showOffersOg({ id: show.id, title: show.title?.rendered ?? "" });
  } catch (error) {
    console.error("[og] Could not confirm the show:", error);
    return false;
  }
}
