/**
 * Single source of truth for the Anthropic model used across the portal
 * (blog generation, blog ideas, AI suggestions, translation, style synthesis).
 *
 * Change the model in ONE place — set `ANTHROPIC_MODEL` in Railway. There is no
 * cross-generation "latest" alias from Anthropic on purpose: a new generation
 * can change accepted parameters (e.g. Sonnet 5 rejects temperature /
 * budget_tokens), prompt behavior, and pricing, so upgrades should be
 * deliberate. `claude-sonnet-5` is itself an alias that auto-tracks the newest
 * Sonnet-5 snapshot; bumping to a future major version is an env change here.
 *
 * The startup health check in instrumentation.ts pings this exact model and
 * emails the admin if it 404s, so a future retirement is caught before a
 * producer hits it.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

/** Resolve the Anthropic model to use, honoring the ANTHROPIC_MODEL override. */
export function getAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
}
