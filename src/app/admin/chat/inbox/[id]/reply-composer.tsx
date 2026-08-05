"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2Icon } from "lucide-react";
import { replyDmAction } from "../../actions";

export function ReplyComposer({ conversationId }: { conversationId: number }) {
  const [body, setBody] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [state, action, pending] = useActionState(replyDmAction, {});

  // Clear the box and close the confirm once a reply lands.
  useEffect(() => {
    if (state.success) {
      setBody("");
      setConfirmOpen(false);
    }
  }, [state.success]);

  return (
    <div className="space-y-2 border-t pt-3">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Write a reply to the member…"
      />
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={!body.trim() || pending}
          onClick={() => setConfirmOpen(true)}
        >
          Send reply
        </Button>
        <span className="text-xs text-muted-foreground">
          Sending emails the member that the team replied (async help-desk, not
          live chat).
        </span>
        {state.message && (
          <span
            className={`text-xs ${state.success ? "text-green-700 dark:text-green-400" : "text-destructive"}`}
          >
            {state.message}
          </span>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send this reply?</DialogTitle>
            <DialogDescription>
              The member will get an email letting them know the team replied.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">
            {body}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <form action={action}>
              <input type="hidden" name="conversation_id" value={conversationId} />
              <input type="hidden" name="body" value={body} />
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  "Send & email"
                )}
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
