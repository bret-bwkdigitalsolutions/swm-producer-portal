import { db } from "@/lib/db";
import { getCachedShows } from "@/lib/wordpress/cache";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IdentityForm } from "./identity-form";
import { AssociateForm } from "./associate-form";
import { requireAdmin } from "@/lib/auth-guard";

export default async function YoutubeIdentitiesPage() {
  await requireAdmin();

  const [identities, youtubeCredentials, shows] = await Promise.all([
    db.youtubeIdentity.findMany({ orderBy: { email: "asc" } }),
    db.platformCredential.findMany({
      where: { platform: "youtube" },
      orderBy: { wpShowId: "asc" },
    }),
    getCachedShows().catch(() => []),
  ]);

  const showName = (wpShowId: number): string => {
    if (wpShowId === 0) return "Network default";
    return shows.find((s) => s.id === wpShowId)?.title.rendered ?? `Show #${wpShowId}`;
  };

  const credsByEmail = new Map<string, typeof youtubeCredentials>();
  for (const c of youtubeCredentials) {
    if (!c.connectedEmail) continue;
    const arr = credsByEmail.get(c.connectedEmail) ?? [];
    arr.push(c);
    credsByEmail.set(c.connectedEmail, arr);
  }

  const orphanCredentials = youtubeCredentials.filter(
    (c) => !c.connectedEmail
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">YouTube Identities</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Cookies that yt-dlp uses to download YouTube videos, keyed by the
          Google account that owns the channel. Each PlatformCredential row
          links here via <code>connectedEmail</code>; downloads route to the
          identity that owns the show via the existing show → network-default
          credential fallback. The <code>YOUTUBE_COOKIES</code> env var stays
          as a safety net until every identity has cookies set.
        </p>
      </div>

      {identities.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No identities yet. Add one below.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {identities.map((identity) => {
            const linkedCreds = credsByEmail.get(identity.email) ?? [];
            const hasCookies = !!identity.cookies?.trim();
            return (
              <Card key={identity.email}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle className="text-lg">
                        {identity.channelTitle ?? identity.email}
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {identity.email}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {hasCookies ? (
                        <Badge className="bg-green-100 text-green-800">
                          Cookies set
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-800">
                          No cookies
                        </Badge>
                      )}
                      {identity.cookiesUpdatedAt && (
                        <span className="text-xs text-muted-foreground">
                          updated{" "}
                          {identity.cookiesUpdatedAt.toISOString().slice(0, 10)}
                        </span>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Linked credentials ({linkedCreds.length})
                    </p>
                    {linkedCreds.length === 0 ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        No PlatformCredential rows reference this identity yet.
                        Link one from the orphan list below.
                      </p>
                    ) : (
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                        {linkedCreds.map((c) => (
                          <li key={c.id}>
                            {showName(c.wpShowId)}{" "}
                            <span className="text-xs text-muted-foreground">
                              (wpShowId={c.wpShowId})
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      Edit identity / update cookies
                    </summary>
                    <div className="mt-3 rounded-md border bg-gray-50 p-4">
                      <IdentityForm
                        defaultEmail={identity.email}
                        defaultChannelTitle={identity.channelTitle ?? ""}
                        defaultChannelId={identity.channelId ?? ""}
                        defaultNotes={identity.notes ?? ""}
                        cookiesAlreadySet={hasCookies}
                        submitLabel="Save changes"
                      />
                    </div>
                  </details>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {orphanCredentials.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Orphan credentials ({orphanCredentials.length})
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              These PlatformCredential rows have no <code>connectedEmail</code>{" "}
              (created before the userinfo scope was added). Link each to its
              owning identity so cookie lookup works for downloads on these
              shows.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {orphanCredentials.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div>
                  <p className="font-medium">{showName(c.wpShowId)}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.channelTitle ?? "—"} · wpShowId={c.wpShowId}
                  </p>
                </div>
                {identities.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Add an identity first
                  </span>
                ) : (
                  <AssociateForm
                    credentialId={c.id}
                    identities={identities.map((i) => ({
                      email: i.email,
                      channelTitle: i.channelTitle,
                    }))}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add identity</CardTitle>
        </CardHeader>
        <CardContent>
          <IdentityForm submitLabel="Add identity" />
        </CardContent>
      </Card>
    </div>
  );
}
