"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateShowHosts } from "./actions";
import { Loader2Icon } from "lucide-react";

interface ShowHostsEditorProps {
  wpShowId: number;
  currentHosts: string;
}

export function ShowHostsEditor({
  wpShowId,
  currentHosts,
}: ShowHostsEditorProps) {
  const [state, formAction, isPending] = useActionState(updateShowHosts, {});

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Host(s)</Label>
      <p className="text-xs text-muted-foreground">
        Used as the author on Transistor episodes. Comma-separated for multiple
        hosts.
      </p>
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="wp_show_id" value={wpShowId} />
        <Input
          name="hosts"
          defaultValue={currentHosts}
          placeholder="e.g. John Henry, Jake White"
          className="max-w-md"
        />
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          {isPending ? <Loader2Icon className="size-4 animate-spin" /> : "Save"}
        </Button>
        {state.success && (
          <span className="text-xs text-green-600">Saved</span>
        )}
      </form>
    </div>
  );
}
