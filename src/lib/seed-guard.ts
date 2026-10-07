import crypto from "crypto";

/**
 * Safety checks for prisma/seed.ts. The seed creates login-capable accounts,
 * so it must never run against production, and it must not use well-known
 * passwords.
 */
export function assertSeedAllowed(env: Record<string, string | undefined> = process.env): void {
  const railwayEnv = (env.RAILWAY_ENVIRONMENT_NAME ?? env.RAILWAY_ENVIRONMENT ?? "").toLowerCase();
  if (env.NODE_ENV === "production" || railwayEnv === "production") {
    throw new Error(
      "Refusing to run the seed script in production (NODE_ENV/RAILWAY_ENVIRONMENT_NAME is production). " +
        "The seed creates login accounts and is for local/dev databases only."
    );
  }
}

/** Password from the given env var, or a random one (flagged so the caller can show it once). */
export function seedPassword(
  envVar: string,
  env: Record<string, string | undefined> = process.env
): { password: string; generated: boolean } {
  const fromEnv = env[envVar];
  if (fromEnv && fromEnv.length >= 12) return { password: fromEnv, generated: false };
  if (fromEnv) {
    throw new Error(`${envVar} must be at least 12 characters.`);
  }
  return { password: crypto.randomBytes(18).toString("base64url"), generated: true };
}
