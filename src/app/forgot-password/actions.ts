"use server";

import { db } from "@/lib/db";
import { createAndSendPasswordReset } from "@/lib/password-reset";

interface ForgotPasswordState {
  // On success we return { sent: true } and let the form render the generic
  // message. The message lives in the client form, not here: a "use server"
  // file may only export async functions, so a shared string constant can't be
  // exported from this module.
  sent?: boolean;
  error?: string;
}

export async function requestPasswordReset(
  _prevState: ForgotPasswordState | null,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = (formData.get("email") as string | null)?.trim().toLowerCase();

  if (!email) {
    return { error: "Please enter your email address." };
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });

  // Only send when the account actually exists — but never reveal that to the
  // caller. Any error during send is swallowed to the same generic response so
  // timing/behavior can't be used to probe for valid emails.
  if (user) {
    try {
      await createAndSendPasswordReset({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
      });
    } catch (err) {
      console.error("[forgot-password] Failed to send reset for a known user:", err);
    }
  }

  return { sent: true };
}
