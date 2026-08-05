"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { revalidatePath } from "next/cache";
import {
  ChatApiError,
  banSubscriber,
  postTeamMessage,
  replyToDm,
  setMessageStatus,
  setThreadLocked,
} from "@/lib/chat/client";
import type { ContextType, MessageStatus } from "@/lib/chat/types";

export interface ChatActionState {
  success?: boolean;
  message?: string;
}

function fail(err: unknown, fallback: string): ChatActionState {
  return {
    success: false,
    message: err instanceof ChatApiError ? err.message : fallback,
  };
}

function num(formData: FormData, key: string): number {
  return parseInt((formData.get(key) as string) ?? "", 10);
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string) ?? "").trim();
}

/**
 * Moderate one message or its thread. `op` distinguishes the button pressed so a
 * row can wire several actions to one server action.
 */
export async function moderateAction(
  _prev: ChatActionState,
  formData: FormData
): Promise<ChatActionState> {
  await requireAdmin();
  const op = str(formData, "op");

  try {
    if (op === "hide" || op === "delete" || op === "restore") {
      const id = num(formData, "message_id");
      if (!Number.isFinite(id)) return { success: false, message: "Bad message id." };
      const status: MessageStatus =
        op === "hide" ? "hidden" : op === "delete" ? "deleted" : "visible";
      await setMessageStatus(id, status);
    } else if (op === "lock" || op === "unlock") {
      const threadId = num(formData, "thread_id");
      if (!Number.isFinite(threadId))
        return { success: false, message: "Bad thread id." };
      await setThreadLocked(threadId, op === "lock");
    } else {
      return { success: false, message: "Unknown operation." };
    }
    revalidatePath("/admin/chat/moderation");
    return { success: true };
  } catch (err) {
    return fail(err, "Moderation action failed.");
  }
}

/** Mute (ban from public chat) a subscriber for a chosen duration. */
export async function muteAction(
  _prev: ChatActionState,
  formData: FormData
): Promise<ChatActionState> {
  await requireAdmin();
  const subscriberId = num(formData, "subscriber_id");
  if (!Number.isFinite(subscriberId))
    return { success: false, message: "Bad subscriber id." };

  const duration = str(formData, "duration") || "+1 day";
  const reason = str(formData, "reason");

  try {
    await banSubscriber({
      subscriber_id: subscriberId,
      duration,
      ...(reason ? { reason } : {}),
    });
    revalidatePath("/admin/chat/moderation");
    return { success: true, message: "Muted." };
  } catch (err) {
    return fail(err, "Failed to mute.");
  }
}

const CONTEXT_TYPES: ContextType[] = ["global", "show", "episode", "appearance"];

/** Post an official Team message into a context. */
export async function postTeamAction(
  _prev: ChatActionState,
  formData: FormData
): Promise<ChatActionState> {
  await requireAdmin();

  const contextType = str(formData, "context_type") as ContextType;
  if (!CONTEXT_TYPES.includes(contextType))
    return { success: false, message: "Pick a valid context." };

  const contextId = contextType === "global" ? 0 : num(formData, "context_id");
  if (contextType !== "global" && !Number.isFinite(contextId))
    return { success: false, message: "Enter a context id (post ID)." };

  const body = str(formData, "body");
  if (!body) return { success: false, message: "Message can't be empty." };

  const authorName = str(formData, "author_name");

  try {
    await postTeamMessage({
      context_type: contextType,
      context_id: contextType === "global" ? 0 : contextId,
      body,
      ...(authorName ? { author_name: authorName } : {}),
    });
    revalidatePath("/admin/chat/moderation");
    return { success: true, message: "Posted as Team." };
  } catch (err) {
    return fail(err, "Failed to post.");
  }
}

/** Reply to a member DM (emails the member — outward-facing). */
export async function replyDmAction(
  _prev: ChatActionState,
  formData: FormData
): Promise<ChatActionState> {
  await requireAdmin();
  const conversationId = num(formData, "conversation_id");
  if (!Number.isFinite(conversationId))
    return { success: false, message: "Bad conversation id." };

  const body = str(formData, "body");
  if (!body) return { success: false, message: "Reply can't be empty." };

  try {
    await replyToDm(conversationId, body);
    revalidatePath(`/admin/chat/inbox/${conversationId}`);
    revalidatePath("/admin/chat/inbox");
    return { success: true, message: "Reply sent — the member has been emailed." };
  } catch (err) {
    return fail(err, "Failed to send reply.");
  }
}
