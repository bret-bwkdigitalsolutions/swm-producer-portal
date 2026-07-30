"use server";

import { db } from "@/lib/db";
import { createAndSendPasswordReset } from "@/lib/password-reset";

interface ForgotPasswordState {
  // Always the same generic success message on submit, regardless of whether
  // the email maps to an account — see below.
  sent?: boolean;
  error?: string;
}

// Deliberately identical whether or not the account exists, to avoid leaking
// which emails are registered (account enumeration).
const GENERIC_SUCCESS =
  "If an account exists for that email, we've sent a link to reset the password. Check your inbox.";

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

export { GENERIC_SUCCESS };
