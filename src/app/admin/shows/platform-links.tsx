"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateShowPlatformLinks } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Loader2Icon } from "lucide-react";

const PLATFORMS = [
  { key: "youtube", label: "YouTube Channel" },
  { key: "spotify", label: "Spotify Show" },
  { key: "apple", label: "Apple Podcast" },
  { key: "transistor", label: "Transistor Show" },
  { key: "website", label: "Website" },
] as const;

interface PlatformLink {
  id: string;
  platform: string;
  url: string;
}

interface NetworkDefault {
  platform: string;
  url: string;
}

interface ShowPlatformLinksProps {
  wpShowId: number;
  showName: string;
  links: PlatformLink[];
  networkDefaults?: NetworkDefault[];
}

export function ShowPlatformLinks({
  wpShowId,
  showName,
  links,
  networkDefaults,
}: ShowPlatformLinksProps) {
  const [state, formAction, isPending] = useActionState(
    updateShowPlatformLinks,
    {}
  );

  const linksByPlatform = new Map(links.map((l) => [l.platform, l.url]));
  const defaultsByPlatform = new Map(
    (networkDefaults ?? []).map((d) => [d.platform, d.url])
  );

  const isNetworkDefaults = wpShowId === 0;

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-muted-foreground">
        Platform links for {showName}
      </p>
      {!isNetworkDefaults && networkDefaults && networkDefaults.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Leave a field blank to use the network default.
        </p>
      )}

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="wp_show_id" value={wpShowId} />

        <div className="grid gap-3 sm:grid-cols-2">
          {PLATFORMS.map(({ key, label }) => {
            const showUrl = linksByPlatform.get(key);
            const defaultUrl = defaultsByPlatform.get(key);
            const hasOverride = !!showUrl;
            const hasDefault = !!defaultUrl && !isNetworkDefaults;

            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor={`${key}-${wpShowId}`}>{label}</Label>
                  {!isNetworkDefaults && hasOverride && hasDefault && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      Override
                    </Badge>
                  )}
                </div>
                <Input
                  id={`${key}-${wpShowId}`}
                  name={`platform_${key}`}
                  type="url"
                  placeholder={
                    hasDefault && !hasOverride
                      ? defaultUrl
                      : "https://..."
                  }
                  defaultValue={showUrl ?? ""}
                  className={
                    !isNetworkDefaults && !hasOverride && hasDefault
                      ? "text-muted-foreground"
                      : ""
                  }
                />
                {!isNetworkDefaults && !hasOverride && hasDefault && (
                  <p className="text-[11px] text-muted-foreground">(Network default)</p>
                )}
              </div>
            );
          })}
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
