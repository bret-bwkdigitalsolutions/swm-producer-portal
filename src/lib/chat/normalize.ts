import type {
  DmConversationSummary,
  DmMessage,
  ModerationMessage,
} from "./types";

// WordPress REST returns integer columns as strings ("id":"15","reported":"0").
// Normalize numeric fields at the API boundary so the UI can rely on real
// numbers (strict `reported === 1` / `is_locked === 1` checks depend on this).

export const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : 0;
};

export const toFlag = (v: unknown): 0 | 1 => (toNum(v) ? 1 : 0);

export function normalizeMessage(raw: Record<string, unknown>): ModerationMessage {
  return {
    id: toNum(raw.id),
    subscriber_id: toNum(raw.subscriber_id),
    body: String(raw.body ?? ""),
    author_name: String(raw.author_name ?? ""),
    author_kind: raw.author_kind === "team" ? "team" : "member",
    status: (raw.status as ModerationMessage["status"]) ?? "visible",
    reported: toFlag(raw.reported),
    created_at: String(raw.created_at ?? ""),
    context_type:
      (raw.context_type as ModerationMessage["context_type"]) ?? "global",
    context_id: toNum(raw.context_id),
    context_title: String(raw.context_title ?? ""),
    thread_id: toNum(raw.thread_id),
    is_locked: toFlag(raw.is_locked),
  };
}

export function normalizeConversation(
  raw: Record<string, unknown>
): DmConversationSummary {
  return {
    id: toNum(raw.id),
    subscriber_id: toNum(raw.subscriber_id),
    status: String(raw.status ?? "open"),
    unread_by_team: toNum(raw.unread_by_team),
    unread_by_member: toNum(raw.unread_by_member),
    last_message_at: String(raw.last_message_at ?? ""),
    created_at: String(raw.created_at ?? ""),
    email: String(raw.email ?? ""),
    display_name: String(raw.display_name ?? ""),
  };
}

export function normalizeDmMessage(raw: Record<string, unknown>): DmMessage {
  return {
    id: toNum(raw.id),
    sender: raw.sender === "team" ? "team" : "member",
    sender_id: toNum(raw.sender_id),
    body: String(raw.body ?? ""),
    created_at: String(raw.created_at ?? ""),
    read_at: (raw.read_at as string | null) ?? null,
  };
}
