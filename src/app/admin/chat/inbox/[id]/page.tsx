import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDmConversation, ChatApiError } from "@/lib/chat/client";
import { formatCentral } from "@/lib/chat/types";
import { ChatApiNotice } from "../../chat-notice";
import { ReplyComposer } from "./reply-composer";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isFinite(id) || id <= 0) notFound();

  let detail;
  let error: unknown = null;
  try {
    // Note: fetching this marks the conversation read by the team (WP side).
    detail = await getDmConversation(id);
  } catch (err) {
    if (err instanceof ChatApiError && err.status === 404) notFound();
    error = err;
  }

  const member =
    detail?.conversation.display_name ||
    detail?.conversation.email ||
    `Member #${detail?.conversation.subscriber_id ?? id}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/chat/inbox">
          <Button variant="ghost" size="sm">
            &larr; Inbox
          </Button>
        </Link>
        {detail && <h3 className="text-lg font-semibold">{member}</h3>}
      </div>

      <ChatApiNotice error={error} />

      {detail && (
        <Card>
          <CardContent className="space-y-3 p-4">
            {detail.conversation.email && (
              <p className="text-xs text-muted-foreground">
                {detail.conversation.email}
              </p>
            )}
            <div className="space-y-3">
              {detail.messages.map((msg) => {
                const fromTeam = msg.sender === "team";
                return (
                  <div
                    key={msg.id}
                    className={`flex ${fromTeam ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        fromTeam
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-70">
                        {fromTeam ? "Team" : "Member"} ·{" "}
                        {formatCentral(msg.created_at)}
                      </div>
                      <p className="whitespace-pre-wrap">{msg.body}</p>
                    </div>
                  </div>
                );
              })}
              {detail.messages.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No messages in this conversation.
                </p>
              )}
            </div>

            <ReplyComposer conversationId={id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
