"use client";

import { useActionState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateShowLanguage } from "./actions";
import { Loader2Icon } from "lucide-react";

interface ShowLanguageEditorProps {
  wpShowId: number;
  currentLanguage: string;
  currentBilingual: boolean;
}

export function ShowLanguageEditor({
  wpShowId,
  currentLanguage,
  currentBilingual,
}: ShowLanguageEditorProps) {
  const [state, formAction, isPending] = useActionState(updateShowLanguage, {});

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Language Settings</Label>
      <p className="text-xs text-muted-foreground">
        Primary language for AI-generated blog content. Bilingual shows get an
        auto-translated version at publish time.
      </p>
      <form action={formAction} className="flex items-center gap-4">
        <input type="hidden" name="wp_show_id" value={wpShowId} />
        <select
          name="language"
          defaultValue={currentLanguage}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm"
        >
          <option value="en">English</option>
          <option value="es">Spanish</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="bilingual"
            defaultChecked={currentBilingual}
            className="rounded border-input"
          />
          Bilingual
        </label>
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
