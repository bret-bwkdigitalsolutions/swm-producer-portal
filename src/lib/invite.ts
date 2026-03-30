import "server-only";

import crypto from "crypto";
import { db } from "@/lib/db";

const INVITE_EXPIRY_HOURS = 48;

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

interface CreateAndSendInviteParams {
  userId: string;
  userName: string | null;
  userEmail: string;
}

export async function createAndSendInvite({
  userId,
  userName,
  userEmail,
}: CreateAndSendInviteParams): Promise<void> {
  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

  // Upsert: replace any existing invite token for this user
  await db.inviteToken.upsert({
    where: { userId },
    create: { userId, token, expiresAt },
    update: { token, expiresAt, usedAt: null },
  });

  // Mark invite as sent on the user
  await db.user.update({
    where: { id: userId },
    data: { inviteSentAt: new Date() },
  });

  await sendInviteEmail({ userName, userEmail, token });
}

interface SendInviteEmailParams {
  userName: string | null;
  userEmail: string;
  token: string;
}

async function sendInviteEmail({
  userName,
  userEmail,
  token,
}: SendInviteEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      "[invite] RESEND_API_KEY is not set — skipping invite email."
    );
    return;
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const setPasswordUrl = `${baseUrl}/set-password/${token}`;
  const loginUrl = `${baseUrl}/login`;

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  const greeting = userName ? `Hi ${userName},` : "Hi,";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 16px; font-size: 20px; color: #111;">
        You're invited to the SWM Producer Portal
      </h2>
      <p style="color: #333; line-height: 1.6;">
        ${greeting}
      </p>
      <p style="color: #333; line-height: 1.6;">
        You've been set up to submit content on the SWM Producer Portal. Click below to create your password and get started.
      </p>
      <a href="${setPasswordUrl}" style="display: inline-block; background: #111; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500; margin: 16px 0;">
        Set Your Password
      </a>
      <p style="color: #666; font-size: 14px; line-height: 1.6;">
        Have a Google account? You can also
        <a href="${loginUrl}" style="color: #111; text-decoration: underline;">sign in with Google</a>
        using your <strong>${userEmail}</strong> address.
      </p>
      <p style="margin-top: 24px; font-size: 12px; color: #999;">
        This link expires in ${INVITE_EXPIRY_HOURS} hours.
      </p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: "SWM Producer Portal <notifications@stolenwatermedia.com>",
      to: [userEmail],
      subject: "You're invited to the SWM Producer Portal",
      html,
    });
  } catch (error) {
    console.error("[invite] Failed to send invite email:", error);
    throw new Error("Failed to send invite email");
  }
}
