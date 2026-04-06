import { requireAdmin } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { getCachedShows } from "@/lib/wordpress/cache";

import { getYouTubePlaylists, type YouTubePlaylist } from "@/lib/youtube-api";
import { getTransistorShows, type TransistorShow } from "@/lib/transistor-api";
import { refreshAccessToken } from "@/lib/youtube-oauth";
import { SyncPlatformLinks } from "./sync-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

interface CredentialError {
  platform: string;
  message: string;
}

export default async function SyncPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { saved } = await searchParams;

  const errors: CredentialError[] = [];

  // Fetch all credentials — network default (wpShowId=0) plus any overrides
  const allCredentials = await db.platformCredential.findMany({
    where: { platform: { in: ["youtube", "transistor"] } },
    orderBy: { wpShowId: "asc" },
  });

  // Get the YouTube credential (prefer network default)
  const ytCred =
    allCredentials.find((c) => c.platform === "youtube" && c.wpShowId === 0) ??
    allCredentials.find((c) => c.platform === "youtube");

  // Get the Transistor credential (prefer network default)
  const trCred =
    allCredentials.find((c) => c.platform === "transistor" && c.wpShowId === 0) ??
    allCredentials.find((c) => c.platform === "transistor");

  // Fetch YouTube playlists
  let ytPlaylists: YouTubePlaylist[] = [];
  if (ytCred?.accessToken) {
    try {
      let accessToken = ytCred.accessToken;

      // Check if token is expired and refresh if needed
      if (ytCred.tokenExpiresAt && ytCred.tokenExpiresAt < new Date()) {
        if (!ytCred.refreshToken) {
          errors.push({
            platform: "YouTube",
            message: "Access token expired and no refresh token available. Please re-authorize.",
          });
        } else {
          try {
            const refreshed = await refreshAccessToken(ytCred.refreshToken);
            accessToken = refreshed.accessToken;

            // Update the credential in DB
            await db.platformCredential.update({
              where: { id: ytCred.id },
              data: {
                accessToken: refreshed.accessToken,
                tokenExpiresAt: refreshed.expiresAt,
                status: "valid",
              },
            });
          } catch (refreshErr) {
            console.error("Failed to refresh YouTube token:", refreshErr);
            errors.push({
              platform: "YouTube",
              message: "Failed to refresh access token. Please re-authorize YouTube.",
            });
          }
        }
      }

      if (!errors.some((e) => e.platform === "YouTube")) {
        ytPlaylists = await getYouTubePlaylists(accessToken);
      }
    } catch (err) {
      console.error("Failed to fetch YouTube playlists:", err);
      errors.push({
        platform: "YouTube",
        message: "Failed to fetch playlists. The token may be invalid — try re-authorizing.",
      });
    }
  } else if (!ytCred) {
    errors.push({
      platform: "YouTube",
      message: "No YouTube credentials configured. Add them in the Credentials page.",
    });
  }

  // Fetch Transistor shows
  let trShows: TransistorShow[] = [];
  if (trCred?.apiKey) {
    try {
      trShows = await getTransistorShows(trCred.apiKey);
    } catch (err) {
      console.error("Failed to fetch Transistor shows:", err);
      errors.push({
        platform: "Transistor",
        message: "Failed to fetch shows. Check your API key.",
      });
    }
  } else if (!trCred) {
    errors.push({
      platform: "Transistor",
      message: "No Transistor credentials configured. Add them in the Credentials page.",
    });
  }

  // Fetch WordPress shows and existing platform links
  const [wpShows, existingLinks] = await Promise.all([
    getCachedShows().catch(() => []),
    db.showPlatformLink.findMany({
      where: {
        platform: { in: ["youtube_playlist", "transistor_show"] },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/admin/shows"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-4" />
          Back to Shows
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Sync Platform Links</h2>
        <Badge variant="secondary">
          {ytPlaylists.length} playlists / {trShows.length} shows discovered
        </Badge>
      </div>

      {saved && (
        <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
          Saved {saved} platform match{saved !== "1" ? "es" : ""} successfully. Green checkmarks show matched items.
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Auto-discovered YouTube playlists and Transistor shows from your connected
        credentials. Match each one to a WordPress show to create platform links
        automatically.
      </p>

      {errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-destructive">
              Credential Issues
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {errors.map((err, i) => (
              <p key={i} className="text-sm">
                <span className="font-medium">{err.platform}:</span>{" "}
                {err.message}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <SyncPlatformLinks
        ytPlaylists={ytPlaylists}
        trShows={trShows}
        wpShows={wpShows.map((s) => ({ id: s.id, title: s.title.rendered }))}
        existingLinks={existingLinks
          .filter((l) => wpShows.some((s) => s.id === l.wpShowId))
          .map((l) => ({
            wpShowId: l.wpShowId,
            platform: l.platform,
            url: l.url,
          }))}
      />
    </div>
  );
}
