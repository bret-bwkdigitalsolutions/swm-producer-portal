import "server-only";
import { db } from "@/lib/db";
import { getShows } from "@/lib/wordpress/client";
import type { AccessibleShow } from "./types";

/**
 * Get the list of shows a user can access for analytics.
 * Admins see all shows. Producers see only their assigned shows.
 */
export async function getAccessibleShows(
  userId: string,
  role: string
): Promise<AccessibleShow[]> {
  const wpShows = await getShows();

  if (role === "admin") {
    return wpShows.map((s) => ({
      wpShowId: s.id,
      title: s.title.rendered,
    }));
  }

  const accessEntries = await db.userShowAccess.findMany({
    where: { userId },
  });

  const allowedIds = new Set(accessEntries.map((a) => a.wpShowId));

  return wpShows
    .filter((s) => allowedIds.has(s.id))
    .map((s) => ({
      wpShowId: s.id,
      title: s.title.rendered,
    }));
}
