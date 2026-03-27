import { db } from "@/lib/db";
import { getCachedShows } from "@/lib/wordpress/cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { HealthCheckButton } from "./health-check-button";

const ALL_PLATFORMS = [
  "youtube",
  "spotify",
  "apple",
  "transistor",
  "patreon",
] as const;

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  spotify: "Spotify",
  apple: "Apple Podcasts",
  transistor: "Transistor",
  patreon: "Patreon",
};

function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    valid: "bg-green-500",
    expiring_soon: "bg-yellow-500",
    expired: "bg-red-500",
  };

  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colorMap[status] ?? "bg-gray-300"}`}
      title={status.replace("_", " ")}
    />
  );
}

export default async function AdminCredentialsPage() {
  const [shows, allCredentials] = await Promise.all([
    getCachedShows().catch(() => []),
    db.platformCredential.findMany({
      orderBy: { platform: "asc" },
    }),
  ]);

  // Group credentials by show ID
  const credentialsByShow = new Map<
    number,
    typeof allCredentials
  >();
  for (const cred of allCredentials) {
    const existing = credentialsByShow.get(cred.wpShowId) ?? [];
    existing.push(cred);
    credentialsByShow.set(cred.wpShowId, existing);
  }

  // Summary counts
  const totalValid = allCredentials.filter((c) => c.status === "valid").length;
  const totalExpiring = allCredentials.filter(
    (c) => c.status === "expiring_soon"
  ).length;
  const totalExpired = allCredentials.filter(
    (c) => c.status === "expired"
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Platform Credentials</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              {totalValid} valid
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
              {totalExpiring} expiring
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              {totalExpired} expired
            </span>
          </div>
          <HealthCheckButton />
        </div>
      </div>

      {shows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No shows found in WordPress.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shows.map((show) => {
            const credentials = credentialsByShow.get(show.id) ?? [];
            const connectedPlatforms = new Set(
              credentials.map((c) => c.platform)
            );
            const unconnectedPlatforms = ALL_PLATFORMS.filter(
              (p) => !connectedPlatforms.has(p)
            );

            return (
              <Card key={show.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="truncate">{show.title.rendered}</span>
                    <Badge variant="outline" className="ml-2 shrink-0 font-mono text-xs">
                      {credentials.length}/{ALL_PLATFORMS.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Connected platforms */}
                  {credentials.length > 0 && (
                    <div className="space-y-1.5">
                      {credentials.map((cred) => (
                        <div
                          key={cred.id}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="flex items-center gap-2">
                            <StatusDot status={cred.status} />
                            {PLATFORM_LABELS[cred.platform] ?? cred.platform}
                          </span>
                          <Badge
                            variant={
                              cred.status === "expired"
                                ? "destructive"
                                : cred.status === "expiring_soon"
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {cred.credentialType === "oauth"
                              ? "OAuth"
                              : "API Key"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Unconnected platforms */}
                  {unconnectedPlatforms.length > 0 && (
                    <div className="space-y-1.5 border-t pt-2">
                      {unconnectedPlatforms.map((platform) => (
                        <div
                          key={platform}
                          className="flex items-center justify-between text-sm text-muted-foreground"
                        >
                          <span className="flex items-center gap-2">
                            <span className="inline-block h-2 w-2 rounded-full bg-gray-300" />
                            {PLATFORM_LABELS[platform]}
                          </span>
                          <span className="text-xs">Not connected</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="pt-2">
                    <Link href={`/admin/credentials/${show.id}`}>
                      <Button variant="outline" size="sm" className="w-full">
                        Manage Credentials
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
