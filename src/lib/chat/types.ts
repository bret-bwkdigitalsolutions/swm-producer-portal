// Types for the SWM community chat, served by the WordPress `swm-chat` plugin
// (source of truth). The portal reads/writes live — never a second cache.

export type MessageStatus = "visible" | "hidden" | "deleted";
export type ContextType = "global" | "show" | "episode" | "appearance";
export type AuthorKind = "member" | "team";

export interface ModerationMessage {
  id: number;
  subscriber_id: number;
  body: string;
  author_name: string;
  author_kind: AuthorKind;
  status: MessageStatus;
  reported: 0 | 1;
  /** Site-local (Central) wall time, "YYYY-MM-DD HH:MM:SS". Not UTC. */
  created_at: string;
  context_type: ContextType;
  context_id: number;
  context_title: string;
  thread_id: number;
  is_locked: 0 | 1;
}

export interface TeamMessagePayload {
  context_type: ContextType;
  context_id: number;
  body: string;
  author_name?: string;
}

export interface BanPayload {
  subscriber_id: number;
  /** PHP strtotime string relative to now, e.g. "+7 days". Defaults +1 day. */
  duration?: string;
  reason?: string;
}

export type DmSender = "member" | "team";

export interface DmConversationSummary {
  id: number;
  subscriber_id: number;
  status: string;
  unread_by_team: number;
  unread_by_member: number;
  last_message_at: string;
  created_at: string;
  email: string;
  display_name: string;
}

export interface DmMessage {
  id: number;
  sender: DmSender;
  sender_id: number;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface DmConversationDetail {
  conversation: Omit<DmConversationSummary, "email" | "display_name"> &
    Partial<Pick<DmConversationSummary, "email" | "display_name">>;
  messages: DmMessage[];
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Format an "YYYY-MM-DD HH:MM:SS" timestamp that is ALREADY in Central time.
 * We must NOT apply any timezone conversion (that would double-shift) — parse
 * the wall-clock parts and format them directly, tagged "CT". Pure/testable.
 */
export function formatCentral(ts: string | null | undefined): string {
  if (!ts) return "—";
  const m = ts.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!m) return ts;
  const [, y, mo, d, hh, mm] = m;
  const month = MONTHS[parseInt(mo, 10) - 1] ?? mo;
  const hour24 = parseInt(hh, 10);
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${month} ${parseInt(d, 10)}, ${y}, ${hour12}:${mm} ${period} CT`;
}
