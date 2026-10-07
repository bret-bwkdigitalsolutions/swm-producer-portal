import crypto from "crypto";

/**
 * Constant-time check of an `Authorization: Bearer <token>` header against
 * the expected secret (avoids leaking the secret through response timing).
 * Both sides are hashed first so differing lengths don't short-circuit.
 */
export function bearerTokenMatches(authHeader: string | null | undefined, expected: string): boolean {
  if (!authHeader || !expected || !authHeader.startsWith("Bearer ")) return false;
  const given = crypto.createHash("sha256").update(authHeader.slice(7)).digest();
  const want = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(given, want);
}
