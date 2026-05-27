"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { saveIdentity } from "./actions";

interface IdentityFormProps {
  defaultEmail?: string;
  defaultChannelTitle?: string;
  defaultChannelId?: string;
  defaultNotes?: string;
  cookiesAlreadySet?: boolean;
  submitLabel?: string;
}

const initialState = { success: undefined, message: undefined };

export function IdentityForm({
  defaultEmail = "",
  defaultChannelTitle = "",
  defaultChannelId = "",
  defaultNotes = "",
  cookiesAlreadySet = false,
  submitLabel = "Save identity",
}: IdentityFormProps) {
  const [state, formAction, isPending] = useActionState(
    saveIdentity,
    initialState
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="email">Google account email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            placeholder="owner@gmail.com"
            defaultValue={defaultEmail}
            readOnly={!!defaultEmail}
          />
        </div>
        <div>
          <Label htmlFor="channelTitle">Channel name (optional)</Label>
          <Input
            id="channelTitle"
            name="channelTitle"
            placeholder="Sunset Lounge DFW"
            defaultValue={defaultChannelTitle}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="channelId">YouTube channel ID (optional)</Label>
        <Input
          id="channelId"
          name="channelId"
          placeholder="UC..."
          defaultValue={defaultChannelId}
        />
      </div>
      <div>
        <Label htmlFor="cookies">
          Cookies (Netscape format){" "}
          {cookiesAlreadySet && (
            <span className="text-xs font-normal text-muted-foreground">
              — leave blank to keep current cookies
            </span>
          )}
        </Label>
        <Textarea
          id="cookies"
          name="cookies"
          rows={8}
          className="font-mono text-xs"
          placeholder={
            cookiesAlreadySet
              ? "Cookies on file. Paste new ones to replace."
              : "# Netscape HTTP Cookie File&#10;.youtube.com\tTRUE\t/\tTRUE\t..."
          }
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Export from a browser logged into the channel owner&apos;s Google
          account, then paste here. See{" "}
          <code>docs/youtube-cookie-refresh.md</code> for the export procedure.
        </p>
      </div>
      <div>
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={2}
          placeholder="Anything future-you will want to remember"
          defaultValue={defaultNotes}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
        {state?.message && (
          <span
            className={
              state.success
                ? "text-sm text-green-700"
                : "text-sm text-red-700"
            }
          >
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
