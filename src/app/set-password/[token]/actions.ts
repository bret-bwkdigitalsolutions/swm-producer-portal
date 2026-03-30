"use server";

import { db } from "@/lib/db";
import { signIn } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";

interface SetPasswordState {
  error?: string;
}

export async function setPassword(
  prevState: SetPasswordState | null,
  formData: FormData
): Promise<SetPasswordState> {
  const token = formData.get("token") as string;
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!token || !password || !confirmPassword) {
    return { error: "All fields are required." };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const invite = await db.inviteToken.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true } } },
  });

  if (!invite) {
    return { error: "Invalid invite link. Please contact your admin." };
  }

  if (invite.usedAt) {
    return { error: "This invite has already been used. Please sign in." };
  }

  if (invite.expiresAt < new Date()) {
    return { error: "This invite link has expired. Please contact your admin for a new one." };
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: invite.user.id },
      data: { hashedPassword },
    });

    await tx.inviteToken.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    });
  });

  // Sign the user in automatically
  await signIn("credentials", {
    email: invite.user.email,
    password,
    redirect: false,
  });

  redirect("/dashboard");
}
