import "server-only";
import type {
  BanPayload,
  DmConversationDetail,
  DmConversationSummary,
  MessageStatus,
  ModerationMessage,
  TeamMessagePayload,
} from "./types";
import {
  normalizeConversation,
  normalizeDmMessage,
  normalizeMessage,
} from "./normalize";

// The community chat lives on the WordPress `swm-chat` plugin. We read/write it
// live with the same portal bearer token as the Subscribers dashboard — every
// call server-side so the token never reaches the browser.

const DEFAULT_BASE_URL = "https://stolenwatermedia.com/wp-json/swm-chat/v1";
const REQUEST_TIMEOUT_MS = 20_000;

function baseUrl(): string {
  return (process.env.SWM_CHAT_API_BASE ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

function token(): string | undefined {
  return process.env.SWM_MEMBERSHIP_API_TOKEN || undefined;
}

/** Whether the portal has a token to talk to the chat API. */
export function isChatApiConfigured(): boolean {
  return !!token();
}

export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly endpoint?: string
  ) {
    super(message);
    this.name = "ChatApiError";
  }

  /** WordPress side reports the plugin isn't configured yet (503 not_configured). */
  get isNotConfigured(): boolean {
    return this.code === "not_configured" || this.status === 503;
  }
}

async function chatFetch<T>(
  endpoint: string,
  init: RequestInit = {}
): Promise<T> {
  const apiToken = token();
  if (!apiToken) {
    throw new ChatApiError(
      "Chat API is not configured (SWM_MEMBERSHIP_API_TOKEN is unset).",
      undefined,
      "portal_token_missing",
      endpoint
    );
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${endpoint}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? "timed out"
        : "could not be reached";
    throw new ChatApiError(`Chat API ${reason}.`, undefined, undefined, endpoint);
  }

  if (!response.ok) {
    // Try to read the plugin's structured error (code/message) without leaking PII.
    let code: string | undefined;
    let message = `Chat API error (${response.status}).`;
    try {
      const body = (await response.json()) as { code?: string; message?: string };
      code = body.code;
      if (response.status === 503 && body.code === "not_configured") {
        message =
          "The chat API on WordPress isn't configured yet (portal token not set on that site).";
      } else if (body.message && response.status === 422) {
        message = body.message;
      }
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new ChatApiError(message, response.status, code, endpoint);
  }

  // Some endpoints return 201/200 with a small ack; callers that don't need the
  // body can ignore it.
  return (await response.json().catch(() => ({}))) as T;
}

// --- Moderation ---

export async function listModerationMessages(
  reportedOnly: boolean
): Promise<ModerationMessage[]> {
  const qs = reportedOnly ? "?reported=1" : "";
  const data = await chatFetch<{ messages: Record<string, unknown>[] }>(
    `/portal/moderation/messages${qs}`
  );
  return (data.messages ?? []).map(normalizeMessage);
}

export async function setMessageStatus(
  id: number,
  status: MessageStatus
): Promise<void> {
  await chatFetch(`/portal/messages/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function setThreadLocked(
  id: number,
  isLocked: boolean
): Promise<void> {
  await chatFetch(`/portal/threads/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ is_locked: isLocked }),
  });
}

export async function postTeamMessage(
  payload: TeamMessagePayload
): Promise<{ id: number }> {
  return chatFetch<{ id: number }>(`/portal/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function banSubscriber(payload: BanPayload): Promise<void> {
  await chatFetch(`/portal/bans`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// --- Team inbox (DMs) ---

export async function listDmConversations(): Promise<DmConversationSummary[]> {
  const data = await chatFetch<{ conversations: Record<string, unknown>[] }>(
    `/portal/dm/conversations`
  );
  return (data.conversations ?? []).map(normalizeConversation);
}

/** Fetching a conversation marks it read by the team (WP side side-effect). */
export async function getDmConversation(
  id: number
): Promise<DmConversationDetail> {
  const data = await chatFetch<{
    conversation: Record<string, unknown>;
    messages: Record<string, unknown>[];
  }>(`/portal/dm/conversations/${id}`);
  return {
    conversation: normalizeConversation(data.conversation ?? {}),
    messages: (data.messages ?? []).map(normalizeDmMessage),
  };
}

export async function replyToDm(id: number, body: string): Promise<void> {
  await chatFetch(`/portal/dm/conversations/${id}/reply`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}
