// Pure password-reset helpers — no DB, no server-only, no email. Split out
// from password-reset.ts so page + action share identical rules and so the
// logic is unit-testable without a database or RSC bundler.

// Reset links are deliberately short-lived — far shorter than the 48h invite
// window — since a reset can be requested at any time by anyone who knows an
// email address.
export const PASSWORD_RESET_EXPIRY_MINUTES = 60;

export type ResetTokenLike = { expiresAt: Date; usedAt: Date | null } | null;
export type ResetTokenStatus = "invalid" | "used" | "expired" | "valid";

/**
 * Classify a reset token's usability. Used by the page (what to render) and the
 * action (whether to accept the new password) so both apply identical rules.
 */
export function resetTokenStatus(token: ResetTokenLike, now: Date): ResetTokenStatus {
  if (!token) return "invalid";
  if (token.usedAt) return "used";
  if (token.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

/**
 * Validate a proposed new password. Returns an error message, or null when the
 * input is acceptable. Kept in sync with the set-password rules.
 */
export function validateNewPassword(
  password: string,
  confirmPassword: string
): string | null {
  if (!password || !confirmPassword) return "All fields are required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password !== confirmPassword) return "Passwords do not match.";
  return null;
}
