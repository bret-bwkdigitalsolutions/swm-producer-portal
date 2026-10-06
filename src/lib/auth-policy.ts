import "server-only";

import { db } from "@/lib/db";

/**
 * Google sign-in is invite-only: the portal never creates an account on first
 * Google login. Only people who already have a user record (created by an
 * admin, which is also how invites work) can sign in with Google, and only
 * with a Google-verified email address.
 */
export async function isGoogleSignInAllowed(
  email: string | null | undefined,
  emailVerified: boolean | undefined
): Promise<boolean> {
  if (!email) return false;
  if (emailVerified === false) return false;
  // Exact match on purpose: the Prisma adapter looks users up by exact email,
  // so allowing a case-insensitive match here would let the adapter create a
  // second (self-created) account with different casing.
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return !!user;
}

export const LOGIN_RATE_LIMITS = {
  /** Failed-or-not attempts per email address. */
  perEmail: { limit: 10, windowSeconds: 15 * 60 },
  /** Attempts per client IP (covers spraying many emails). */
  perIp: { limit: 50, windowSeconds: 15 * 60 },
};

export const PASSWORD_RESET_RATE_LIMITS = {
  perEmail: { limit: 3, windowSeconds: 60 * 60 },
  perIp: { limit: 10, windowSeconds: 60 * 60 },
};
