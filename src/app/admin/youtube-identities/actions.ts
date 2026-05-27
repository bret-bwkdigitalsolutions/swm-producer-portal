"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

interface FormState {
  success?: boolean;
  message?: string;
}

async function requireAdmin(): Promise<FormState | null> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }
  return null;
}

function isLikelyNetscapeCookies(raw: string): boolean {
  if (!raw.includes("# Netscape HTTP Cookie File")) return false;
  const lines = raw.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  // Need at least one real cookie row to be useful
  return lines.length > 0;
}

export async function saveIdentity(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const email = ((formData.get("email") as string) ?? "").trim().toLowerCase();
  const channelTitle =
    ((formData.get("channelTitle") as string) ?? "").trim() || null;
  const channelId =
    ((formData.get("channelId") as string) ?? "").trim() || null;
  const cookies = ((formData.get("cookies") as string) ?? "").trim();
  const notes = ((formData.get("notes") as string) ?? "").trim() || null;

  if (!email || !email.includes("@")) {
    return { success: false, message: "Email is required." };
  }
  if (cookies && !isLikelyNetscapeCookies(cookies)) {
    return {
      success: false,
      message:
        'Cookies must be in Netscape format (starts with "# Netscape HTTP Cookie File" and include at least one cookie row).',
    };
  }

  const hasCookies = cookies.length > 0;

  await db.youtubeIdentity.upsert({
    where: { email },
    create: {
      email,
      channelTitle,
      channelId,
      notes,
      cookies: hasCookies ? cookies : null,
      cookiesUpdatedAt: hasCookies ? new Date() : null,
    },
    update: {
      channelTitle,
      channelId,
      notes,
      ...(hasCookies ? { cookies, cookiesUpdatedAt: new Date() } : {}),
    },
  });

  revalidatePath("/admin/youtube-identities");
  return {
    success: true,
    message: hasCookies
      ? "Identity saved with cookies."
      : "Identity saved (no cookies set yet).",
  };
}

export async function deleteIdentity(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const email = ((formData.get("email") as string) ?? "").trim().toLowerCase();
  if (!email) return { success: false, message: "Email required." };

  await db.youtubeIdentity.delete({ where: { email } });
  revalidatePath("/admin/youtube-identities");
  return { success: true, message: "Identity removed." };
}

/**
 * Set PlatformCredential.connectedEmail so a row that was created before the
 * userinfo scope was added (e.g., the wpShowId=0 SLN default) can be linked
 * to a YoutubeIdentity. Validates that the credential exists and that the
 * identity exists.
 */
export async function associateCredential(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const credentialId = ((formData.get("credentialId") as string) ?? "").trim();
  const email = ((formData.get("email") as string) ?? "").trim().toLowerCase();

  if (!credentialId || !email) {
    return { success: false, message: "Credential and identity are required." };
  }

  const [cred, identity] = await Promise.all([
    db.platformCredential.findUnique({ where: { id: credentialId } }),
    db.youtubeIdentity.findUnique({ where: { email } }),
  ]);
  if (!cred) return { success: false, message: "Credential not found." };
  if (!identity) return { success: false, message: "Identity not found." };

  await db.platformCredential.update({
    where: { id: credentialId },
    data: { connectedEmail: email },
  });

  revalidatePath("/admin/youtube-identities");
  return { success: true, message: "Credential linked." };
}
