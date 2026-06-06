"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateShowPremium } from "./actions";
import { Loader2Icon } from "lucide-react";

interface ShowPremiumEditorProps {
  wpShowId: number;
  premiumEnabled: boolean;
  transistorPrivateShowId: string | null;
}

export function ShowPremiumEditor({
  wpShowId,
  premiumEnabled,
  transistorPrivateShowId,
}: ShowPremiumEditorProps) {
  const [state, formAction, isPending] = useActionState(updateShowPremium, {});
  const [enabled, setEnabled] = useState(premiumEnabled);

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Premium Content</Label>
      <p className="text-xs text-muted-foreground">
        Enable to gate episodes behind a private Transistor feed. Requires a
        separate private Transistor show ID.
      </p>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="wpShowId" value={wpShowId} />
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`premium-enabled-${wpShowId}`}
            name="premiumEnabled"
            value="true"
            defaultChecked={premiumEnabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-4"
          />
          <Label htmlFor={`premium-enabled-${wpShowId}`} className="text-sm font-normal cursor-pointer">
            Enable premium feed
          </Label>
        </div>
        {enabled && (
          <div className="flex items-center gap-2">
            <Input
              name="transistorPrivateShowId"
              defaultValue={transistorPrivateShowId ?? ""}
              placeholder="Transistor private show ID"
              className="max-w-md"
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button type="submit" variant="outline" size="sm" disabled={isPending}>
            {isPending ? <Loader2Icon className="size-4 animate-spin" /> : "Save"}
          </Button>
          {state.success && (
            <span className="text-xs text-green-600">Saved</span>
          )}
          {state.message && !state.success && (
            <span className="text-xs text-red-600">{state.message}</span>
          )}
        </div>
      </form>
    </div>
  );
}
