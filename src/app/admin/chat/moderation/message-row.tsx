"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2Icon } from "lucide-react";
import { moderateAction, muteAction } from "../actions";
import { formatCentral } from "@/lib/chat/types";
import type { ModerationMessage } from "@/lib/chat/types";

export function MessageRow({ m }: { m: ModerationMessage }) {
  const [modState, modAction, modPending] = useActionState(moderateAction, {});
  const locked = m.is_locked === 1;

  return (
    <div
      className={`rounded-lg border p-3 ${
        m.reported ? "border-amber-300 bg-amber-50/40 dark:bg-amber-950/10" : ""
      } ${m.status !== "visible" ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{m.author_name}</span>
        {m.author_kind === "team" ? (
          <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
            Team
          </Badge>
        ) : (
          <Badge variant="outline">Member</Badge>
        )}
        <Badge variant="outline" className="font-normal">
          {m.context_type}: {m.context_title || `#${m.context_id}`}
        </Badge>
        {m.reported === 1 && (
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
            ⚑ reported
          </span>
        )}
        {m.status !== "visible" && (
          <Badge variant="outline" className="uppercase">
            {m.status}
          </Badge>
        )}
        {locked && <Badge variant="outline">🔒 thread locked</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatCentral(m.created_at)}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm">{m.body}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {m.status === "visible" ? (
          <OpButton
            action={modAction}
            pending={modPending}
            op="hide"
            messageId={m.id}
            label="Hide"
            variant="outline"
          />
        ) : (
          <OpButton
            action={modAction}
            pending={modPending}
            op="restore"
            messageId={m.id}
            label="Restore"
            variant="outline"
          />
        )}

        {/* Delete — confirm */}
        {m.status !== "deleted" && (
          <ConfirmOp
            action={modAction}
            pending={modPending}
            op="delete"
            messageId={m.id}
            triggerLabel="Delete"
            title="Delete this message?"
            description="It will immediately stop showing to members. You can restore it later."
            confirmLabel="Delete"
          />
        )}

        {/* Lock / unlock the thread */}
        <OpButton
          action={modAction}
          pending={modPending}
          op={locked ? "unlock" : "lock"}
          threadId={m.thread_id}
          label={locked ? "Unlock thread" : "Lock thread"}
          variant="ghost"
        />

        {/* Mute author (members only) */}
        {m.author_kind === "member" && (
          <MuteDialog subscriberId={m.subscriber_id} authorName={m.author_name} />
        )}

        {modState.message && !modState.success && (
          <span className="text-xs text-destructive">{modState.message}</span>
        )}
      </div>
    </div>
  );
}

function OpButton({
  action,
  pending,
  op,
  messageId,
  threadId,
  label,
  variant,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  op: string;
  messageId?: number;
  threadId?: number;
  label: string;
  variant: "outline" | "ghost" | "default";
}) {
  return (
    <form action={action}>
      <input type="hidden" name="op" value={op} />
      {messageId != null && (
        <input type="hidden" name="message_id" value={messageId} />
      )}
      {threadId != null && (
        <input type="hidden" name="thread_id" value={threadId} />
      )}
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {label}
      </Button>
    </form>
  );
}

function ConfirmOp({
  action,
  pending,
  op,
  messageId,
  triggerLabel,
  title,
  description,
  confirmLabel,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  op: string;
  messageId: number;
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="destructive" />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <form
            action={(fd) => {
              action(fd);
              setOpen(false);
            }}
          >
            <input type="hidden" name="op" value={op} />
            <input type="hidden" name="message_id" value={messageId} />
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={pending}
            >
              {confirmLabel}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MuteDialog({
  subscriberId,
  authorName,
}: {
  subscriberId: number;
  authorName: string;
}) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState("+7 days");
  const [state, action, pending] = useActionState(muteAction, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        Mute author
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mute {authorName}?</DialogTitle>
          <DialogDescription>
            Blocks them from posting in public chat for the chosen window. They
            can still message the team privately. Mutes lift automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          action={(fd) => {
            fd.set("duration", duration);
            action(fd);
          }}
          className="space-y-3"
        >
          <input type="hidden" name="subscriber_id" value={subscriberId} />
          <div className="space-y-1">
            <Label className="text-xs">Duration</Label>
            <Select
              value={duration}
              onValueChange={(v) => setDuration(v ?? "+7 days")}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="+1 day">1 day</SelectItem>
                <SelectItem value="+7 days">7 days</SelectItem>
                <SelectItem value="+30 days">30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`reason-${subscriberId}`} className="text-xs">
              Reason (optional)
            </Label>
            <Input
              id={`reason-${subscriberId}`}
              name="reason"
              placeholder="spam, harassment…"
              className="h-9"
            />
          </div>
          {state.message && (
            <p
              className={`text-xs ${state.success ? "text-green-700 dark:text-green-400" : "text-destructive"}`}
            >
              {state.message}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={pending}
            >
              {pending ? <Loader2Icon className="size-4 animate-spin" /> : "Mute"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
