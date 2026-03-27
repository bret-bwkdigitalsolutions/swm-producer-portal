"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidateTag } from "next/cache";
import { revalidatePath } from "next/cache";

interface FormState {
  success?: boolean;
  message?: string;
}

export async function addStakeholder(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  const wpShowId = parseInt(formData.get("wp_show_id") as string, 10);
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const name = (formData.get("name") as string)?.trim();

  if (!wpShowId || isNaN(wpShowId)) {
    return { success: false, message: "Invalid show." };
  }
  if (!email) {
    return { success: false, message: "Email is required." };
  }
  if (!name) {
    return { success: false, message: "Name is required." };
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { success: false, message: "Invalid email address." };
  }

  try {
    await db.showStakeholder.create({
      data: { wpShowId, email, name },
    });
    return { success: true, message: `Added ${name} as a stakeholder.` };
  } catch (error: unknown) {
    // Handle unique constraint violation
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return {
        success: false,
        message: "This email is already a stakeholder for this show.",
      };
    }
    console.error("Failed to add stakeholder:", error);
    return { success: false, message: "Failed to add stakeholder." };
  }
}

const VALID_LINK_PLATFORMS = [
  "youtube",
  "spotify",
  "apple",
  "transistor",
  "patreon",
  "website",
] as const;

export async function updateShowPlatformLinks(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  const wpShowId = parseInt(formData.get("wp_show_id") as string, 10);
  if (!wpShowId || isNaN(wpShowId)) {
    return { success: false, message: "Invalid show." };
  }

  const urlPattern = /^https?:\/\/.+/;

  try {
    for (const platform of VALID_LINK_PLATFORMS) {
      const url = (formData.get(`platform_${platform}`) as string)?.trim();

      if (url) {
        if (!urlPattern.test(url)) {
          return {
            success: false,
            message: `Invalid URL for ${platform}. URLs must start with http:// or https://.`,
          };
        }

        await db.showPlatformLink.upsert({
          where: { wpShowId_platform: { wpShowId, platform } },
          create: { wpShowId, platform, url },
          update: { url },
        });
      } else {
        // Remove the link if the URL was cleared
        await db.showPlatformLink.deleteMany({
          where: { wpShowId, platform },
        });
      }
    }

    return { success: true, message: "Platform links saved." };
  } catch (error) {
    console.error("Failed to update platform links:", error);
    return { success: false, message: "Failed to save platform links." };
  }
}

export async function refreshShowCache(): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  revalidateTag("wp-shows", "max");
  revalidateTag("wp-taxonomies", "max");
  revalidatePath("/admin/shows");
  revalidatePath("/dashboard");

  return { success: true, message: "Cache cleared. Show data refreshed from WordPress." };
}

export async function removeStakeholder(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  const id = formData.get("id") as string;
  if (!id) {
    return { success: false, message: "Stakeholder ID is required." };
  }

  try {
    await db.showStakeholder.delete({ where: { id } });
    return { success: true, message: "Stakeholder removed." };
  } catch {
    return { success: false, message: "Failed to remove stakeholder." };
  }
}
