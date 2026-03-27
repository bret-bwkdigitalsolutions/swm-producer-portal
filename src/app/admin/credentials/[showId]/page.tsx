import { db } from "@/lib/db";
import { getCachedShows } from "@/lib/wordpress/cache";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CredentialCard, EmptyPlatformCard } from "@/components/admin/credential-card";
import { CredentialForm } from "./credential-form";

const ALL_PLATFORMS = [
  "youtube",
  "spotify",
  "apple",
  "transistor",
  "podbean",
  "patreon",
] as const;

export default async function ShowCredentialsPage({
  params,
}: {
  params: Promise<{ showId: string }>;
}) {
  const { showId: showIdParam } = await params;
  const wpShowId = parseInt(showIdParam, 10);
  if (isNaN(wpShowId)) {
    notFound();
  }

  const [shows, credentials] = await Promise.all([
    getCachedShows().catch(() => []),
    db.platformCredential.findMany({
      where: { wpShowId },
      orderBy: { platform: "asc" },
    }),
  ]);

  const show = shows.find((s) => s.id === wpShowId);
  if (!show) {
    notFound();
  }

  const connectedPlatforms = new Map(
    credentials.map((c) => [c.platform, c])
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
          <h2 className="text-2xl font-bold">{show.title.rendered}</h2>
          <Badge variant="outline" className="font-mono text-xs">
            ID: {wpShowId}
          </Badge>
        </div>
        <Badge variant="secondary">
          {credentials.length}/{ALL_PLATFORMS.length} connected
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ALL_PLATFORMS.map((platform) => {
          const cred = connectedPlatforms.get(platform);

          if (cred) {
            return (
              <CredentialCard
                key={platform}
                credential={{
                  id: cred.id,
                  platform: cred.platform,
                  credentialType: cred.credentialType,
                  status: cred.status,
                  tokenExpiresAt: cred.tokenExpiresAt?.toISOString() ?? null,
                }}
              />
            );
          }

          return <EmptyPlatformCard key={platform} platform={platform} />;
        })}
      </div>

      <div className="border-t pt-6">
        <h3 className="mb-4 text-lg font-semibold">Add / Edit Credential</h3>
        <CredentialForm
          wpShowId={wpShowId}
          existingCredentials={credentials.map((c) => ({
            id: c.id,
            platform: c.platform,
            credentialType: c.credentialType,
            accessToken: c.accessToken ? "********" : "",
            refreshToken: c.refreshToken ? "********" : "",
            apiKey: c.apiKey ? "********" : "",
            tokenExpiresAt: c.tokenExpiresAt?.toISOString().slice(0, 16) ?? "",
          }))}
        />
      </div>
    </div>
  );
}
