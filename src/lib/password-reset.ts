import "server-only";

import crypto from "crypto";
import { db } from "@/lib/db";
import { PASSWORD_RESET_EXPIRY_MINUTES } from "@/lib/password-reset-token";

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

interface CreateAndSendPasswordResetParams {
  userId: string;
  userName: string | null;
  userEmail: string;
}

/**
 * Issue a fresh password-reset link and email it. Any prior reset tokens for
 * the user are deleted first so old links stop working the moment a new one is
 * requested (a single live reset link per user).
 */
export async function createAndSendPasswordReset({
  userId,
  userName,
  userEmail,
}: CreateAndSendPasswordResetParams): Promise<void> {
  const token = generateResetToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000);

  await db.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({ where: { userId } });
    await tx.passwordResetToken.create({ data: { userId, token, expiresAt } });
  });

  await sendPasswordResetEmail({ userName, userEmail, token });
}

interface SendPasswordResetEmailParams {
  userName: string | null;
  userEmail: string;
  token: string;
}

async function sendPasswordResetEmail({
  userName,
  userEmail,
  token,
}: SendPasswordResetEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[password-reset] RESEND_API_KEY is not set — skipping reset email.");
    return;
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const resetUrl = `${baseUrl}/reset-password/${token}`;

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  const greeting = userName ? `Hi ${userName},` : "Hi,";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 16px; font-size: 20px; color: #111;">
        Reset your SWM Producer Portal password
      </h2>
      <p style="color: #333; line-height: 1.6;">${greeting}</p>
      <p style="color: #333; line-height: 1.6;">
        We received a request to reset the password for your SWM Producer Portal
        account. Click below to choose a new password.
      </p>
      <a href="${resetUrl}" style="display: inline-block; background: #111; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500; margin: 16px 0;">
        Reset Password
      </a>
      <p style="color: #666; font-size: 14px; line-height: 1.6;">
        If you didn't request this, you can safely ignore this email — your
        password won't change.
      </p>
      <p style="margin-top: 24px; font-size: 12px; color: #999;">
        This link expires in ${PASSWORD_RESET_EXPIRY_MINUTES} minutes.
      </p>
    </div>
  `;

  const { data, error } = await resend.emails.send({
    from: "SWM Producer Portal <info@stolenwatermedia.com>",
    to: [userEmail],
    subject: "Reset your SWM Producer Portal password",
    html,
  });

  if (error) {
    console.error("[password-reset] Resend API error:", error);
    throw new Error(`Failed to send password reset email: ${error.message}`);
  }

  console.log(`[password-reset] Email sent to ${userEmail} (id: ${data?.id})`);
}
