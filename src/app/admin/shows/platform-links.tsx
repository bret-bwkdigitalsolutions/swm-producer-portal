"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateShowPlatformLinks } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Loader2Icon } from "lucide-react";

// Account-level: where content gets uploaded TO (channel, account)
const ACCOUNT_PLATFORMS = [
  {
    key: "youtube_channel",
    label: "YouTube Channel",
    placeholder: "https://www.youtube.com/channel/UC...",
    help: "The YouTube channel URL where videos are uploaded",
  },
  {
    key: "transistor_account",
    label: "Transistor Dashboard",
    placeholder: "https://dashboard.transistor.fm",
    help: "Your Transistor dashboard URL (API key goes in Credentials)",
  },
  {
    key: "spotify_account",
    label: "Spotify for Podcasters",
    placeholder: "https://podcasters.spotify.com/...",
    help: "Your Spotify for Podcasters dashboard",
  },
  {
    key: "apple_account",
    label: "Apple Podcasts Connect",
    placeholder: "https://podcastsconnect.apple.com/...",
    help: "Your Apple Podcasts Connect dashboard",
  },
  {
    key: "website",
    label: "Website",
    placeholder: "https://stolenwatermedia.com",
    help: "The main website for this network/show",
  },
] as const;

// Show-level: the specific show/podcast/playlist within each account
const SHOW_PLATFORMS = [
  {
    key: "youtube_playlist",
    label: "YouTube Playlist",
    placeholder: "https://www.youtube.com/playlist?list=PL...",
    help: "The playlist for this show — videos added here after upload",
  },
  {
    key: "transistor_show",
    label: "Transistor Show",
    placeholder: "12345 or https://dashboard.transistor.fm/shows/your-show",
    help: "Transistor numeric show ID (preferred) or dashboard URL",
  },
  {
    key: "spotify_show",
    label: "Spotify Show URL",
    placeholder: "https://open.spotify.com/show/...",
    help: "The show's public Spotify URL",
  },
  {
    key: "apple_show",
    label: "Apple Podcasts Show URL",
    placeholder: "https://podcasts.apple.com/podcast/...",
    help: "The show's public Apple Podcasts URL",
  },
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

  // Network defaults show account-level fields + network feed
  // Individual shows show both (account overrides + show-level)
  const accountFields = ACCOUNT_PLATFORMS;
  const showFields = isNetworkDefaults
    ? [
        {
          key: "transistor_show" as const,
          label: "Network Transistor Feed",
          placeholder: "12345 (Transistor show ID for the network umbrella feed)",
          help: "Episodes from all network shows are cross-posted here (except shows with their own Transistor account)",
        },
      ]
    : SHOW_PLATFORMS;

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-muted-foreground">
        Platform links for {showName}
      </p>
      {!isNetworkDefaults && (
        <p className="text-xs text-muted-foreground">
          Account fields default to the network settings. Only override if this
          show uses a different channel/account (e.g. Your Dark Companion).
        </p>
      )}

      <form action={formAction} className="space-y-5">
        <input type="hidden" name="wp_show_id" value={wpShowId} />

        {/* Account-level fields */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isNetworkDefaults
              ? "Default Accounts / Channels"
              : "Account Overrides"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {accountFields.map(({ key, label, placeholder, help }) => (
              <PlatformField
                key={key}
                fieldKey={key}
                wpShowId={wpShowId}
                label={label}
                placeholder={placeholder}
                help={help}
                showUrl={linksByPlatform.get(key)}
                defaultUrl={defaultsByPlatform.get(key)}
                isNetworkDefaults={isNetworkDefaults}
              />
            ))}
          </div>
        </div>

        {/* Show-level fields (only for individual shows) */}
        {showFields.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Show-Specific Links
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {showFields.map(({ key, label, placeholder, help }) => (
                <PlatformField
                  key={key}
                  fieldKey={key}
                  wpShowId={wpShowId}
                  label={label}
                  placeholder={placeholder}
                  help={help}
                  showUrl={linksByPlatform.get(key)}
                  isNetworkDefaults={false}
                />
              ))}
            </div>
          </div>
        )}

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

function PlatformField({
  fieldKey,
  wpShowId,
  label,
  placeholder,
  help,
  showUrl,
  defaultUrl,
  isNetworkDefaults,
}: {
  fieldKey: string;
  wpShowId: number;
  label: string;
  placeholder: string;
  help: string;
  showUrl?: string;
  defaultUrl?: string;
  isNetworkDefaults: boolean;
}) {
  const hasOverride = !!showUrl;
  const hasDefault = !!defaultUrl && !isNetworkDefaults;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label htmlFor={`${fieldKey}-${wpShowId}`} className="text-xs">
          {label}
        </Label>
        {!isNetworkDefaults && hasOverride && hasDefault && (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0"
          >
            Override
          </Badge>
        )}
      </div>
      <Input
        id={`${fieldKey}-${wpShowId}`}
        name={`platform_${fieldKey}`}
        type="url"
        placeholder={
          hasDefault && !hasOverride ? defaultUrl : placeholder
        }
        defaultValue={showUrl ?? ""}
        className={
          !isNetworkDefaults && !hasOverride && hasDefault
            ? "text-muted-foreground"
            : ""
        }
      />
      {!isNetworkDefaults && !hasOverride && hasDefault ? (
        <p className="text-[11px] text-muted-foreground">(Network default)</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">{help}</p>
      )}
    </div>
  );
}
