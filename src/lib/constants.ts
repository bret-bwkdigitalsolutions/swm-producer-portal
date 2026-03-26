export const ContentType = {
  REVIEW: "review",
  TRAILER: "trailer",
  APPEARANCE: "appearance",
  EPISODE: "episode",
  CASE_DOCUMENT: "case_document",
  SHOW: "show",
} as const;

export type ContentTypeValue = (typeof ContentType)[keyof typeof ContentType];

export const CONTENT_TYPE_LABELS: Record<ContentTypeValue, string> = {
  [ContentType.REVIEW]: "Reviews",
  [ContentType.TRAILER]: "Trailers",
  [ContentType.APPEARANCE]: "Appearances",
  [ContentType.EPISODE]: "Episodes",
  [ContentType.CASE_DOCUMENT]: "Case Documents",
  [ContentType.SHOW]: "Shows",
};

export const UserRole = {
  ADMIN: "admin",
  PRODUCER: "producer",
} as const;

export type UserRoleValue = (typeof UserRole)[keyof typeof UserRole];
