import { db } from "@/lib/db";
import { getCachedShows } from "@/lib/wordpress/cache";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CredentialCard, EmptyPlatformCard } from "@/components/admin/credential-card";
import { ConnectYouTubeButton } from "@/components/admin/connect-youtube-button";
import { CredentialForm } from "./credential-form";

const ALL_PLATFORMS = [
  "youtube",
  "spotify",
  "apple",
  "transistor",
] as const;

export default async function ShowCredentialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ showId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { showId: showIdParam } = await params;
  const { success: successMsg, error: errorMsg } = await searchParams;
  const wpShowId = parseInt(showIdParam, 10);
  if (isNaN(wpShowId) || wpShowId < 0) {
    notFound();
  }

  const isNetworkDefaults = wpShowId === 0;

  const [shows, credentials, networkCredentials] = await Promise.all([
    getCachedShows().catch(() => []),
    db.platformCredential.findMany({
      where: { wpShowId },
      orderBy: { platform: "asc" },
    }),
    // Fetch network defaults for comparison (not needed for network page itself)
    isNetworkDefaults
      ? Promise.resolve([])
      : db.platformCredential.findMany({
          where: { wpShowId: 0 },
          orderBy: { platform: "asc" },
        }),
  ]);

  const show = isNetworkDefaults
    ? null
    : shows.find((s) => s.id === wpShowId);

  if (!isNetworkDefaults && !show) {
    notFound();
  }

  const pageTitle = isNetworkDefaults
    ? "Network Default Credentials"
    : show!.title.rendered;

  const connectedPlatforms = new Map(
    credentials.map((c) => [c.platform, c])
  );
  const networkPlatformMap = new Map(
    networkCredentials.map((c) => [c.platform, c])
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/credentials">
            <Button variant="ghost" size="sm">
              &larr; Back
            </Button>
          </Link>
          <h2 className="text-2xl font-bold">{pageTitle}</h2>
          {isNetworkDefaults && (
            <Badge variant="outline" className="text-xs">
              Applies to all shows
            </Badge>
          )}
        </div>
      </div>

      {isNetworkDefaults && (
        <p className="text-sm text-muted-foreground">
          Set API keys and OAuth tokens here once. All shows will use these
          unless they have their own override credentials.
        </p>
      )}

      {!isNetworkDefaults && (
        <p className="text-sm text-muted-foreground">
          Only add credentials here if this show uses a different account than
          the network default (e.g. Your Dark Companion). Leave empty to use
          network defaults.
        </p>
      )}

      {/* Success/error messages from OAuth callback */}
      {successMsg && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      {/* YouTube OAuth connect button */}
      <div className="flex items-center gap-3">
        <ConnectYouTubeButton
          wpShowId={wpShowId}
          hasExisting={connectedPlatforms.has("youtube")}
        />
        <span className="text-xs text-muted-foreground">
          Signs into Google to authorize YouTube channel uploads
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ALL_PLATFORMS.map((platform) => {
          const cred = connectedPlatforms.get(platform);
          const networkCred = networkPlatformMap.get(platform);

          if (cred) {
            return (
              <CredentialCard
                key={platform}
                credential={{
                  id: cred.id,
                  platform: cred.platform,
                  credentialType: cred.credentialType,
                  status: cred.status,
                  tokenExpiresAt:
                    cred.tokenExpiresAt?.toISOString() ?? null,
                  channelId: cred.channelId,
                  channelTitle: cred.channelTitle,
                  connectedEmail: cred.connectedEmail,
                }}
                isOverride={!isNetworkDefaults}
              />
            );
          }

          if (!isNetworkDefaults && networkCred) {
            return (
              <CredentialCard
                key={platform}
                credential={{
                  id: networkCred.id,
                  platform: networkCred.platform,
                  credentialType: networkCred.credentialType,
                  status: networkCred.status,
                  tokenExpiresAt:
                    networkCred.tokenExpiresAt?.toISOString() ?? null,
                  channelId: networkCred.channelId,
                  channelTitle: networkCred.channelTitle,
                  connectedEmail: networkCred.connectedEmail,
                }}
                isNetworkDefault
              />
            );
          }

          return <EmptyPlatformCard key={platform} platform={platform} />;
        })}
      </div>

      <div className="border-t pt-6">
        <h3 className="mb-4 text-lg font-semibold">
          {isNetworkDefaults
            ? "Add / Edit Network Credential"
            : "Add Show Override"}
        </h3>
        <CredentialForm
          wpShowId={wpShowId}
          existingCredentials={credentials.map((c) => ({
            id: c.id,
            platform: c.platform,
            credentialType: c.credentialType,
            accessToken: c.accessToken ? "********" : "",
            refreshToken: c.refreshToken ? "********" : "",
            apiKey: c.apiKey ? "********" : "",
            tokenExpiresAt:
              c.tokenExpiresAt?.toISOString().slice(0, 16) ?? "",
          }))}
        />
      </div>
    </div>
  );
}
