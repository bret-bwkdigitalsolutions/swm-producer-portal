import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listDmConversations } from "@/lib/chat/client";
import type { DmConversationSummary } from "@/lib/chat/types";
import { formatCentral } from "@/lib/chat/types";
import { AutoRefresh } from "@/components/auto-refresh";
import { ChatApiNotice } from "../chat-notice";

export default async function InboxPage() {
  let conversations: DmConversationSummary[] = [];
  let error: unknown = null;
  try {
    conversations = await listDmConversations();
  } catch (err) {
    error = err;
  }

  // Newest activity first.
  conversations.sort((a, b) =>
    (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "")
  );
  const unreadTotal = conversations.reduce(
    (n, c) => n + (c.unread_by_team > 0 ? 1 : 0),
    0
  );

  return (
    <div className="space-y-4">
      <AutoRefresh intervalMs={25_000} />

      <ChatApiNotice error={error} />

      {!error && (
        <p className="text-sm text-muted-foreground">
          {conversations.length} conversation
          {conversations.length === 1 ? "" : "s"}
          {unreadTotal > 0 && (
            <span className="ml-2 font-medium text-foreground">
              · {unreadTotal} unread
            </span>
          )}
        </p>
      )}

      {!error && conversations.length === 0 && (
        <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          No member messages yet.
        </p>
      )}

      <div className="space-y-2">
        {conversations.map((c) => {
          const unread = c.unread_by_team > 0;
          return (
            <Link key={c.id} href={`/admin/chat/inbox/${c.id}`}>
              <Card
                className={`transition-colors hover:bg-muted/40 ${
                  unread ? "border-primary/40 bg-primary/5" : ""
                }`}
              >
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {c.display_name || c.email || `Member #${c.subscriber_id}`}
                      </span>
                      {unread && (
                        <Badge className="bg-primary text-primary-foreground">
                          New
                        </Badge>
                      )}
                      {c.status !== "open" && (
                        <Badge variant="outline" className="uppercase">
                          {c.status}
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.email}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatCentral(c.last_message_at)}
                  </span>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
