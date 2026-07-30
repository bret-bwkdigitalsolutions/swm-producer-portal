"use server";

import { db } from "@/lib/db";
import { signIn } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { resetTokenStatus, validateNewPassword } from "@/lib/password-reset-token";

interface ResetPasswordState {
  error?: string;
}

export async function resetPassword(
  _prevState: ResetPasswordState | null,
  formData: FormData
): Promise<ResetPasswordState> {
  const token = formData.get("token") as string;
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!token) {
    return { error: "Missing reset token. Please use the link from your email." };
  }

  const validationError = validateNewPassword(password, confirmPassword);
  if (validationError) {
    return { error: validationError };
  }

  const reset = await db.passwordResetToken.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true } } },
  });

  const status = resetTokenStatus(reset, new Date());
  if (status === "invalid") {
    return { error: "Invalid reset link. Please request a new one." };
  }
  if (status === "used") {
    return { error: "This reset link has already been used. Please sign in." };
  }
  if (status === "expired") {
    return { error: "This reset link has expired. Please request a new one." };
  }

  // status === "valid" — reset is non-null here.
  const hashedPassword = await bcrypt.hash(password, 12);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: reset!.user.id },
      data: { hashedPassword },
    });

    await tx.passwordResetToken.update({
      where: { id: reset!.id },
      data: { usedAt: new Date() },
    });
  });

  // Sign the user in automatically, matching the set-password flow.
  await signIn("credentials", {
    email: reset!.user.email,
    password,
    redirect: false,
  });

  redirect("/dashboard");
}
