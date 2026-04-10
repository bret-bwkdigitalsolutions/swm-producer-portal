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
  // Account-level (channel/account)
  "youtube_channel",
  "transistor_account",
  "spotify_account",
  "apple_account",
  "website",
  // Show-level (playlist/show)
  "youtube_playlist",
  "transistor_show",
  "spotify_show",
  "apple_show",
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
  if (isNaN(wpShowId) || wpShowId < 0) {
    return { success: false, message: "Invalid show." };
  }

  const urlPattern = /^https?:\/\/.+/;

  try {
    for (const platform of VALID_LINK_PLATFORMS) {
      const url = (formData.get(`platform_${platform}`) as string)?.trim();

      if (url) {
        // Allow plain numeric IDs for Transistor show fields, require URLs for everything else
        const isNumericIdField = platform === "transistor_show";
        const isValidValue = isNumericIdField
          ? /^\d+$/.test(url) || urlPattern.test(url)
          : urlPattern.test(url);

        if (!isValidValue) {
          return {
            success: false,
            message: isNumericIdField
              ? `Invalid value for ${platform}. Enter a numeric Transistor show ID or a URL.`
              : `Invalid URL for ${platform}. URLs must start with http:// or https://.`,
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

export async function updateShowHosts(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  const wpShowId = parseInt(formData.get("wp_show_id") as string, 10);
  const hosts = (formData.get("hosts") as string)?.trim() ?? "";

  if (isNaN(wpShowId) || wpShowId <= 0) {
    return { success: false, message: "Invalid show." };
  }

  try {
    await db.showMetadata.upsert({
      where: { wpShowId },
      create: { wpShowId, hosts },
      update: { hosts },
    });

    revalidatePath("/admin/shows");
    return { success: true, message: "Hosts saved." };
  } catch (error) {
    console.error("Failed to update show hosts:", error);
    return { success: false, message: "Failed to save hosts." };
  }
}

export async function updateShowLanguage(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  const wpShowId = parseInt(formData.get("wp_show_id") as string, 10);
  const language = (formData.get("language") as string)?.trim() || "en";
  const bilingual = formData.get("bilingual") === "on";

  if (isNaN(wpShowId) || wpShowId <= 0) {
    return { success: false, message: "Invalid show." };
  }

  if (language !== "en" && language !== "es") {
    return { success: false, message: "Invalid language." };
  }

  try {
    await db.showMetadata.upsert({
      where: { wpShowId },
      create: { wpShowId, hosts: "", language, bilingual },
      update: { language, bilingual },
    });

    revalidatePath("/admin/shows");
    return { success: true, message: "Language settings saved." };
  } catch (error) {
    console.error("Failed to update show language:", error);
    return { success: false, message: "Failed to save language settings." };
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
