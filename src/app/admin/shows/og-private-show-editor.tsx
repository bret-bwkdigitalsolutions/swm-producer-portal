"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateOgTransistorShow } from "./actions";
import { Loader2Icon } from "lucide-react";

interface OgPrivateShowEditorProps {
  wpShowId: number;
  ogTransistorShowId: string | null;
}

export function OgPrivateShowEditor({
  wpShowId,
  ogTransistorShowId,
}: OgPrivateShowEditorProps) {
  const [state, formAction, isPending] = useActionState(updateOgTransistorShow, {});

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">The OG private podcast</Label>
      <p className="text-xs text-muted-foreground">
        Transistor&apos;s API cannot create a show. In the Transistor dashboard,
        add a private podcast for The OG, then paste its numeric show ID or
        slug here. OG episodes publish to this show. This is separate from the
        premium feed above, and it is not the public Your Dark Companion show.
      </p>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="wpShowId" value={wpShowId} />
        <Input
          name="ogTransistorShowId"
          defaultValue={ogTransistorShowId ?? ""}
          placeholder="Numeric show ID or slug"
          className="max-w-md"
          autoComplete="off"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" variant="outline" size="sm" disabled={isPending}>
            {isPending ? <Loader2Icon className="size-4 animate-spin" /> : "Save"}
          </Button>
          {state.success && <span className="text-xs text-green-600">Saved</span>}
          {state.message && !state.success && (
            <span className="text-xs text-red-600">{state.message}</span>
          )}
        </div>
      </form>
    </div>
  );
}
