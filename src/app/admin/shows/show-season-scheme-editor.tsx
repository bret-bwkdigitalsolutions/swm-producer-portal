"use client";

import { useActionState, useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateShowSeasonScheme, bumpCurrentSeason } from "./actions";
import { Loader2Icon } from "lucide-react";

interface Props {
  wpShowId: number;
  currentScheme: "none" | "season" | "case";
  currentSeason: number | null;
}

export function ShowSeasonSchemeEditor({
  wpShowId,
  currentScheme,
  currentSeason,
}: Props) {
  const [saveState, saveAction, isSaving] = useActionState(updateShowSeasonScheme, {});
  const [bumpState, bumpAction, isBumping] = useActionState(bumpCurrentSeason, {});
  const [scheme, setScheme] = useState(currentScheme);

  const seasonLabel =
    scheme === "case" ? "Current Case" : scheme === "season" ? "Current Season" : "";
  const bumpLabel =
    currentScheme === "case" ? "Bump to next Case" : "Bump to next Season";

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Season Numbering</Label>
      <p className="text-xs text-muted-foreground">
        Controls how season/episode numbers are handled for this show.{" "}
        <strong>None</strong> hides the inputs entirely.{" "}
        <strong>Season</strong> uses traditional season + episode (Clubhouse).{" "}
        <strong>Case</strong> labels them Case + Part (Signal 51).
      </p>
      <form action={saveAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="wp_show_id" value={wpShowId} />
        <div>
          <Label htmlFor={`scheme_${wpShowId}`} className="text-xs">
            Scheme
          </Label>
          <select
            id={`scheme_${wpShowId}`}
            name="season_scheme"
            value={scheme}
            onChange={(e) => setScheme(e.target.value as typeof scheme)}
            className="mt-1 block rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm"
          >
            <option value="none">None</option>
            <option value="season">Season (e.g. Clubhouse)</option>
            <option value="case">Case (e.g. Signal 51)</option>
          </select>
        </div>
        {scheme !== "none" && (
          <div>
            <Label htmlFor={`current_${wpShowId}`} className="text-xs">
              {seasonLabel}
            </Label>
            <Input
              id={`current_${wpShowId}`}
              name="current_season"
              type="number"
              min="1"
              defaultValue={currentSeason ?? 1}
              required
              className="mt-1 w-24"
            />
          </div>
        )}
        <Button type="submit" variant="outline" size="sm" disabled={isSaving}>
          {isSaving ? <Loader2Icon className="size-4 animate-spin" /> : "Save"}
        </Button>
        {saveState.success && (
          <span className="text-xs text-green-600">{saveState.message}</span>
        )}
        {saveState.success === false && saveState.message && (
          <span className="text-xs text-red-600">{saveState.message}</span>
        )}
      </form>
      {currentScheme !== "none" && currentSeason != null && (
        <form action={bumpAction} className="flex items-center gap-2 pt-1">
          <input type="hidden" name="wp_show_id" value={wpShowId} />
          <Button type="submit" variant="ghost" size="sm" disabled={isBumping}>
            {isBumping ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              `${bumpLabel} (currently ${currentSeason})`
            )}
          </Button>
          {bumpState.success && (
            <span className="text-xs text-green-600">{bumpState.message}</span>
          )}
        </form>
      )}
    </div>
  );
}
