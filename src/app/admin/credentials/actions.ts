"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

interface FormState {
  success?: boolean;
  message?: string;
}

const VALID_PLATFORMS = [
  "youtube",
  "spotify",
  "apple",
  "transistor",
  "podbean",
  "patreon",
] as const;

const VALID_CREDENTIAL_TYPES = ["oauth", "api_key"] as const;

export async function saveCredential(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  const wpShowId = parseInt(formData.get("wpShowId") as string, 10);
  const platform = formData.get("platform") as string;
  const credentialType = formData.get("credentialType") as string;
  const accessToken = (formData.get("accessToken") as string)?.trim() || null;
  const refreshToken =
    (formData.get("refreshToken") as string)?.trim() || null;
  const apiKey = (formData.get("apiKey") as string)?.trim() || null;
  const tokenExpiresAtRaw = formData.get("tokenExpiresAt") as string;

  if (!wpShowId || isNaN(wpShowId)) {
    return { success: false, message: "Invalid show." };
  }

  if (!VALID_PLATFORMS.includes(platform as (typeof VALID_PLATFORMS)[number])) {
    return { success: false, message: "Invalid platform." };
  }

  if (
    !VALID_CREDENTIAL_TYPES.includes(
      credentialType as (typeof VALID_CREDENTIAL_TYPES)[number]
    )
  ) {
    return { success: false, message: "Invalid credential type." };
  }

  if (credentialType === "api_key" && !apiKey) {
    return { success: false, message: "API key is required." };
  }

  if (credentialType === "oauth" && !accessToken) {
    return { success: false, message: "Access token is required for OAuth." };
  }

  const tokenExpiresAt = tokenExpiresAtRaw
    ? new Date(tokenExpiresAtRaw)
    : null;

  // Determine status based on expiry
  let status = "valid";
  if (tokenExpiresAt) {
    const now = new Date();
    const sevenDaysFromNow = new Date(
      now.getTime() + 7 * 24 * 60 * 60 * 1000
    );
    if (tokenExpiresAt < now) {
      status = "expired";
    } else if (tokenExpiresAt < sevenDaysFromNow) {
      status = "expiring_soon";
    }
  }

  try {
    await db.platformCredential.upsert({
      where: { wpShowId_platform: { wpShowId, platform } },
      create: {
        wpShowId,
        platform,
        credentialType,
        accessToken,
        refreshToken,
        apiKey,
        tokenExpiresAt,
        status,
      },
      update: {
        credentialType,
        accessToken,
        refreshToken,
        apiKey,
        tokenExpiresAt,
        status,
      },
    });

    revalidatePath("/admin/credentials");
    revalidatePath(`/admin/credentials/${wpShowId}`);
    return { success: true, message: `${platform} credential saved.` };
  } catch (error) {
    console.error("Failed to save credential:", error);
    return { success: false, message: "Failed to save credential." };
  }
}

export async function deleteCredential(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  const id = formData.get("id") as string;
  if (!id) {
    return { success: false, message: "Credential ID is required." };
  }

  try {
    const credential = await db.platformCredential.findUnique({
      where: { id },
    });
    if (!credential) {
      return { success: false, message: "Credential not found." };
    }

    await db.platformCredential.delete({ where: { id } });

    revalidatePath("/admin/credentials");
    revalidatePath(`/admin/credentials/${credential.wpShowId}`);
    return { success: true, message: "Credential deleted." };
  } catch {
    return { success: false, message: "Failed to delete credential." };
  }
}

export async function checkCredentialHealth(): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  try {
    const credentials = await db.platformCredential.findMany();
    const now = new Date();
    const sevenDaysFromNow = new Date(
      now.getTime() + 7 * 24 * 60 * 60 * 1000
    );

    let updated = 0;

    for (const cred of credentials) {
      let newStatus = "valid";

      if (cred.tokenExpiresAt) {
        if (cred.tokenExpiresAt < now) {
          newStatus = "expired";
        } else if (cred.tokenExpiresAt < sevenDaysFromNow) {
          newStatus = "expiring_soon";
        }
      }

      if (newStatus !== cred.status) {
        await db.platformCredential.update({
          where: { id: cred.id },
          data: { status: newStatus },
        });
        updated++;
      }
    }

    revalidatePath("/admin/credentials");
    return {
      success: true,
      message: `Health check complete. ${updated} credential${updated !== 1 ? "s" : ""} updated.`,
    };
  } catch (error) {
    console.error("Failed to check credential health:", error);
    return { success: false, message: "Failed to check credential health." };
  }
}
