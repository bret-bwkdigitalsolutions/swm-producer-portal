export const SOCIAL_PLATFORMS = [
  "facebook_page",
  "instagram",
  "tiktok",
  "x",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_ACCOUNT_KINDS = ["show", "host", "network"] as const;

export type SocialAccountKind = (typeof SOCIAL_ACCOUNT_KINDS)[number];

export const SOCIAL_ACCOUNT_STATUSES = [
  "active",
  "needs_reauth",
  "removed",
] as const;

export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

export function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

export function isSocialAccountKind(value: string): value is SocialAccountKind {
  return (SOCIAL_ACCOUNT_KINDS as readonly string[]).includes(value);
}

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook_page: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
};

export const KIND_LABELS: Record<SocialAccountKind, string> = {
  show: "Show",
  host: "Host",
  network: "Network",
};

// Application-level invariant: kind="show" requires wpShowId, kind="host"
// requires hostName. Prisma cannot express conditional non-null, so callers
// validate via assertValidKindFields before persisting.
export type SocialAccountKindFields =
  | { kind: "show"; wpShowId: number; hostName?: null }
  | { kind: "host"; hostName: string; wpShowId?: null }
  | { kind: "network"; wpShowId?: null; hostName?: null };

export function assertValidKindFields(
  kind: string,
  wpShowId: number | null | undefined,
  hostName: string | null | undefined
): asserts kind is SocialAccountKind {
  if (!isSocialAccountKind(kind)) {
    throw new Error(`Invalid SocialAccount kind: ${kind}`);
  }
  if (kind === "show" && (wpShowId === null || wpShowId === undefined)) {
    throw new Error("SocialAccount kind='show' requires wpShowId");
  }
  if (kind === "host" && !hostName) {
    throw new Error("SocialAccount kind='host' requires hostName");
  }
}
