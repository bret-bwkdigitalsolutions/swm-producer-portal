"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateShowPlatformLinks } from "./actions";
import { Loader2Icon } from "lucide-react";

const PLATFORMS = [
  { key: "youtube", label: "YouTube Channel" },
  { key: "spotify", label: "Spotify Show" },
  { key: "apple", label: "Apple Podcast" },
  { key: "transistor", label: "Transistor Show" },
  { key: "patreon", label: "Patreon Page" },
  { key: "website", label: "Website" },
] as const;

interface PlatformLink {
  id: string;
  platform: string;
  url: string;
}

interface ShowPlatformLinksProps {
  wpShowId: number;
  showName: string;
  links: PlatformLink[];
}

export function ShowPlatformLinks({
  wpShowId,
  showName,
  links,
}: ShowPlatformLinksProps) {
  const [state, formAction, isPending] = useActionState(
    updateShowPlatformLinks,
    {}
  );

  const linksByPlatform = new Map(links.map((l) => [l.platform, l.url]));

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-muted-foreground">
        Platform links for {showName}
      </p>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="wp_show_id" value={wpShowId} />

        <div className="grid gap-3 sm:grid-cols-2">
          {PLATFORMS.map(({ key, label }) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`${key}-${wpShowId}`}>{label}</Label>
              <Input
                id={`${key}-${wpShowId}`}
                name={`platform_${key}`}
                type="url"
                placeholder={`https://...`}
                defaultValue={linksByPlatform.get(key) ?? ""}
              />
            </div>
          ))}
        </div>

        {state.message && (
          <p
            className={`text-sm ${
              state.success
                ? "text-green-700 dark:text-green-400"
                : "text-destructive"
            }`}
          >
            {state.message}
          </p>
        )}

        <Button type="submit" disabled={isPending} size="default">
          {isPending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            "Save Platform Links"
          )}
        </Button>
      </form>
    </div>
  );
}
