export const ContentType = {
  REVIEW: "review",
  TRAILER: "trailer",
  APPEARANCE: "appearance",
  EPISODE: "episode",
  CASE_DOCUMENT: "case_document",
  SHOW: "show",
  REACTION: "reaction",
} as const;

export type ContentTypeValue = (typeof ContentType)[keyof typeof ContentType];

export const CONTENT_TYPE_LABELS: Record<ContentTypeValue, string> = {
  [ContentType.REVIEW]: "Reviews",
  [ContentType.TRAILER]: "Trailers",
  [ContentType.APPEARANCE]: "Appearances",
  [ContentType.EPISODE]: "Episodes",
  [ContentType.CASE_DOCUMENT]: "Case Documents",
  [ContentType.SHOW]: "Shows",
  [ContentType.REACTION]: "Reactions",
};

export const UserRole = {
  ADMIN: "admin",
  PRODUCER: "producer",
} as const;

export type UserRoleValue = (typeof UserRole)[keyof typeof UserRole];

// Shows that use season numbers on Transistor. Every other show in the network
// must publish episodes with `season = null`. Each show appears twice because
// of legacy duplicate ShowPlatformLink rows mapping multiple wpShowIds to the
// same Transistor show. (The Clubhouse Podcast → 75953; Signal 51 → 75948.)
export const WP_SHOW_IDS_WITH_SEASONS: ReadonlySet<number> = new Set([
  27, 15, // The Clubhouse Podcast
  24, 12, // Signal 51 Chronicles
]);

export function showUsesSeasons(wpShowId: number): boolean {
  return WP_SHOW_IDS_WITH_SEASONS.has(wpShowId);
}
