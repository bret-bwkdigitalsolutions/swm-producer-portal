import Link from "next/link";
import { listModerationMessages } from "@/lib/chat/client";
import type { ModerationMessage } from "@/lib/chat/types";
import { AutoRefresh } from "@/components/auto-refresh";
import { MessageRow } from "./message-row";
import { TeamComposer } from "./team-composer";
import { ChatApiNotice } from "../chat-notice";

export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ reported?: string }>;
}) {
  const { reported } = await searchParams;
  const reportedOnly = reported === "1";

  let messages: ModerationMessage[] = [];
  let error: unknown = null;
  try {
    messages = await listModerationMessages(reportedOnly);
  } catch (err) {
    error = err;
  }

  return (
    <div className="space-y-5">
      <AutoRefresh intervalMs={30_000} />

      <TeamComposer />

      <div className="flex items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border text-sm">
          <Link
            href="/admin/chat/moderation?reported=1"
            className={`px-3 py-1.5 ${reportedOnly ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            ⚑ Reported only
          </Link>
          <Link
            href="/admin/chat/moderation"
            className={`px-3 py-1.5 ${!reportedOnly ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            All recent
          </Link>
        </div>
        <span className="text-xs text-muted-foreground">
          {reportedOnly
            ? "Flagged messages first — clear the queue."
            : "Latest 200 visible messages, newest first. Auto-refreshes."}
        </span>
      </div>

      <ChatApiNotice error={error} />

      {!error && messages.length === 0 && (
        <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          {reportedOnly
            ? "No reported messages. 🎉"
            : "No messages to show."}
        </p>
      )}

      <div className="space-y-2">
        {messages.map((m) => (
          <MessageRow key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}
