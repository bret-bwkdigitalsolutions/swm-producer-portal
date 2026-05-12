"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

interface ActionResult {
  success: boolean;
  message?: string;
}

export async function disconnectSocialAccount(
  socialAccountId: string
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  if (!socialAccountId) {
    return { success: false, message: "Missing socialAccountId." };
  }

  const account = await db.socialAccount.findUnique({
    where: { id: socialAccountId },
  });
  if (!account) {
    return { success: false, message: "Account not found." };
  }

  // Soft-delete: preserve snapshot history. Cascade-delete the credential
  // so a fresh OAuth event cannot reuse a stale token.
  await db.$transaction([
    db.socialAccountCredential.deleteMany({
      where: { socialAccountId },
    }),
    db.socialAccount.update({
      where: { id: socialAccountId },
      data: { status: "removed" },
    }),
  ]);

  revalidatePath("/admin/social-accounts");
  return { success: true };
}

export async function markNeedsReauth(
  socialAccountId: string
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  await db.socialAccount.update({
    where: { id: socialAccountId },
    data: { status: "needs_reauth" },
  });

  revalidatePath("/admin/social-accounts");
  return { success: true };
}
