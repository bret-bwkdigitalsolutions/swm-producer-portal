"use client";

import { useActionState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { savePlatformMatches } from "./actions";
import {
  Loader2Icon,
  CheckCircle2Icon,
  PlaySquareIcon,
  PodcastIcon,
} from "lucide-react";

interface YouTubePlaylist {
  id: string;
  title: string;
  thumbnail: string;
  itemCount: number;
}

interface TransistorShow {
  id: string;
  title: string;
  description: string;
  websiteUrl: string;
  imageUrl: string;
}

interface WpShow {
  id: number;
  title: string;
}

interface ExistingLink {
  wpShowId: number;
  platform: string;
  url: string;
}

interface SyncPlatformLinksProps {
  ytPlaylists: YouTubePlaylist[];
  trShows: TransistorShow[];
  wpShows: WpShow[];
  existingLinks: ExistingLink[];
}

/**
 * Simple fuzzy match: normalize both strings, check if one contains the other
 * or if they share significant words.
 */
function findBestMatch(
  itemTitle: string,
  wpShows: WpShow[]
): number | null {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim();

  const normalizedItem = normalize(itemTitle);
  const itemWords = normalizedItem.split(/\s+/).filter((w) => w.length > 2);

  let bestScore = 0;
  let bestMatch: number | null = null;

  for (const show of wpShows) {
    const normalizedShow = normalize(show.title);
    const showWords = normalizedShow.split(/\s+/).filter((w) => w.length > 2);

    // Exact match
    if (normalizedItem === normalizedShow) return show.id;

    // One contains the other
    if (normalizedItem.includes(normalizedShow) || normalizedShow.includes(normalizedItem)) {
      const score = Math.min(normalizedItem.length, normalizedShow.length) / Math.max(normalizedItem.length, normalizedShow.length);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = show.id;
      }
      continue;
    }

    // Count shared words
    if (itemWords.length > 0 && showWords.length > 0) {
      const sharedWords = itemWords.filter((w) => showWords.includes(w));
      const score = sharedWords.length / Math.max(itemWords.length, showWords.length);
      if (score > bestScore && score >= 0.4) {
        bestScore = score;
        bestMatch = show.id;
      }
    }
  }

  return bestMatch;
}

export function SyncPlatformLinks({
  ytPlaylists,
  trShows,
  wpShows,
  existingLinks,
}: SyncPlatformLinksProps) {
  const [state, formAction, isPending] = useActionState(savePlatformMatches, {});

  // Build lookup: platform+url -> wpShowId for existing matches
  const existingYtMatches = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of existingLinks) {
      if (link.platform === "youtube_playlist") {
        // Extract playlist ID from URL
        const match = link.url.match(/list=([^&]+)/);
        if (match) {
          map.set(match[1], link.wpShowId);
        }
      }
    }
    return map;
  }, [existingLinks]);

  const existingTrMatches = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of existingLinks) {
      if (link.platform === "transistor_show") {
        // Try to extract show ID from URL, or just use the URL
        const match = link.url.match(/shows\/(\d+)/);
        if (match) {
          map.set(match[1], link.wpShowId);
        }
      }
    }
    return map;
  }, [existingLinks]);

  // Also build a reverse lookup: wpShowId -> platform for showing which shows are already matched
  const wpShowMatchedPlatforms = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const link of existingLinks) {
      const existing = map.get(link.wpShowId) ?? [];
      existing.push(link.platform);
      map.set(link.wpShowId, existing);
    }
    return map;
  }, [existingLinks]);

  // Compute auto-suggested matches for items not already matched
  const ytSuggestions = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const pl of ytPlaylists) {
      const existing = existingYtMatches.get(pl.id);
      if (existing) {
        map.set(pl.id, existing);
      } else {
        map.set(pl.id, findBestMatch(pl.title, wpShows));
      }
    }
    return map;
  }, [ytPlaylists, wpShows, existingYtMatches]);

  const trSuggestions = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const show of trShows) {
      const existing = existingTrMatches.get(show.id);
      if (existing) {
        map.set(show.id, existing);
      } else {
        map.set(show.id, findBestMatch(show.title, wpShows));
      }
    }
    return map;
  }, [trShows, wpShows, existingTrMatches]);

  const hasAnyItems = ytPlaylists.length > 0 || trShows.length > 0;

  if (!hasAnyItems) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No playlists or shows discovered. Make sure your platform credentials are
          configured correctly.
        </CardContent>
      </Card>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      {/* YouTube Playlists */}
      {ytPlaylists.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <PlaySquareIcon className="size-5 text-red-600" />
              YouTube Playlists
              <Badge variant="secondary">{ytPlaylists.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {ytPlaylists.map((pl) => {
              const isMatched = existingYtMatches.has(pl.id);
              const suggestedId = ytSuggestions.get(pl.id);

              return (
                <div
                  key={pl.id}
                  className="flex items-center gap-4 rounded-lg border p-3"
                >
                  {pl.thumbnail && (
                    <img
                      src={pl.thumbnail}
                      alt={pl.title}
                      className="h-12 w-20 rounded object-cover shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{pl.title}</p>
                      {isMatched && (
                        <CheckCircle2Icon className="size-4 shrink-0 text-green-600" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {pl.itemCount} video{pl.itemCount !== 1 ? "s" : ""} · {pl.id}
                    </p>
                  </div>
                  <div className="shrink-0 w-56">
                    <MatchSelect
                      name={`yt_${pl.id}`}
                      wpShows={wpShows}
                      defaultValue={suggestedId ?? undefined}
                      wpShowMatchedPlatforms={wpShowMatchedPlatforms}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Transistor Shows */}
      {trShows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <PodcastIcon className="size-5 text-purple-600" />
              Transistor Shows
              <Badge variant="secondary">{trShows.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {trShows.map((show) => {
              const isMatched = existingTrMatches.has(show.id);
              const suggestedId = trSuggestions.get(show.id);

              return (
                <div
                  key={show.id}
                  className="flex items-center gap-4 rounded-lg border p-3"
                >
                  {show.imageUrl && (
                    <img
                      src={show.imageUrl}
                      alt={show.title}
                      className="size-12 rounded object-cover shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{show.title}</p>
                      {isMatched && (
                        <CheckCircle2Icon className="size-4 shrink-0 text-green-600" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {show.description
                        ? show.description.slice(0, 80) +
                          (show.description.length > 80 ? "..." : "")
                        : `ID: ${show.id}`}
                    </p>
                  </div>
                  <div className="shrink-0 w-56">
                    <MatchSelect
                      name={`tr_${show.id}`}
                      wpShows={wpShows}
                      defaultValue={suggestedId ?? undefined}
                      wpShowMatchedPlatforms={wpShowMatchedPlatforms}
                    />
                    {/* Hidden field to pass the website URL */}
                    {show.websiteUrl && (
                      <input
                        type="hidden"
                        name={`tr_url_${show.id}`}
                        value={show.websiteUrl}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Status message */}
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

      {/* Save button */}
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} size="default">
          {isPending ? (
            <>
              <Loader2Icon className="size-4 animate-spin mr-2" />
              Saving...
            </>
          ) : (
            "Save Matches"
          )}
        </Button>
      </div>
    </form>
  );
}

/**
 * A native <select> for matching a discovered item to a WP show.
 * Using a native select here because @base-ui/react Select doesn't support
 * standard form name/value submission in the same way — we need the value
 * to be submitted with the form.
 */
function MatchSelect({
  name,
  wpShows,
  defaultValue,
  wpShowMatchedPlatforms,
}: {
  name: string;
  wpShows: WpShow[];
  defaultValue?: number;
  wpShowMatchedPlatforms: Map<number, string[]>;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue ?? ""}
      className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
    >
      <option value="">Skip</option>
      {wpShows.map((show) => {
        const platforms = wpShowMatchedPlatforms.get(show.id);
        const hasYt = platforms?.includes("youtube_playlist");
        const hasTr = platforms?.includes("transistor_show");
        const indicators = [hasYt ? "YT" : "", hasTr ? "TR" : ""]
          .filter(Boolean)
          .join(",");
        const suffix = indicators ? ` [${indicators}]` : "";

        return (
          <option key={show.id} value={show.id}>
            {show.title}{suffix}
          </option>
        );
      })}
    </select>
  );
}
