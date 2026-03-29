"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

interface FormState {
  success?: boolean;
  message?: string;
}

/**
 * Save platform matches from the auto-sync page.
 * Each match maps a YouTube playlist or Transistor show to a WordPress show.
 */
export async function savePlatformMatches(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  try {
    // Collect all youtube_playlist matches: key = yt_{playlistId}, value = wpShowId
    // Collect all transistor_show matches: key = tr_{showId}, value = wpShowId
    const entries = Array.from(formData.entries());
    let savedCount = 0;

    for (const [key, value] of entries) {
      const wpShowId = parseInt(value as string, 10);
      if (!wpShowId || isNaN(wpShowId) || wpShowId <= 0) continue;

      if (key.startsWith("yt_")) {
        const playlistId = key.slice(3);
        const url = `https://www.youtube.com/playlist?list=${playlistId}`;

        await db.showPlatformLink.upsert({
          where: { wpShowId_platform: { wpShowId, platform: "youtube_playlist" } },
          create: { wpShowId, platform: "youtube_playlist", url },
          update: { url },
        });
        savedCount++;
      } else if (key.startsWith("tr_")) {
        const showId = key.slice(3);
        const url = `https://dashboard.transistor.fm/shows/${showId}`;

        await db.showPlatformLink.upsert({
          where: { wpShowId_platform: { wpShowId, platform: "transistor_show" } },
          create: { wpShowId, platform: "transistor_show", url },
          update: { url },
        });
        savedCount++;
      }
    }

    if (savedCount === 0) {
      return { success: false, message: "No matches selected. Choose a show for at least one item." };
    }

    revalidatePath("/admin/shows");
    revalidatePath("/admin/shows/sync");

    return {
      success: true,
      message: `Saved ${savedCount} platform match${savedCount !== 1 ? "es" : ""}.`,
    };
  } catch (error) {
    console.error("Failed to save platform matches:", error);
    return { success: false, message: "Failed to save platform matches." };
  }
}
