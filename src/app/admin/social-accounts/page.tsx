import { db } from "@/lib/db";
import { getCachedShows } from "@/lib/wordpress/cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SocialAccountCard } from "@/components/admin/social-account-card";
import { SocialConnectButtons } from "@/components/admin/social-connect-buttons";
import {
  groupByKind,
  sortByPlatform,
  type SocialAccountSummary,
} from "./grouping";

export default async function AdminSocialAccountsPage() {
  // Pull all SocialAccount rows + their latest snapshot in one query.
  const rows = await db.socialAccount.findMany({
    where: { status: { not: "removed" } },
    orderBy: [{ kind: "asc" }, { platform: "asc" }],
    include: {
      snapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
      },
    },
  });

  const shows = await getCachedShows().catch(() => []);
  const showTitleById = new Map<number, string>(
    shows.map((s) => [s.id, s.title.rendered])
  );

  const accounts: SocialAccountSummary[] = rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    kind: r.kind,
    wpShowId: r.wpShowId,
    hostName: r.hostName,
    handle: r.handle,
    displayName: r.displayName,
    status: r.status,
    latestFollowerCount: r.snapshots[0]?.followerCount ?? null,
    latestCapturedAt: r.snapshots[0]?.capturedAt ?? null,
  }));

  const grouped = groupByKind(accounts);

  const metaConfigured =
    !!process.env.META_APP_ID && !!process.env.META_APP_SECRET;
  const tiktokConfigured =
    !!process.env.TIKTOK_CLIENT_KEY && !!process.env.TIKTOK_CLIENT_SECRET;
  const xConfigured = !!process.env.X_BEARER_TOKEN;

  const totalActive = accounts.filter((a) => a.status === "active").length;
  const totalNeedsReauth = accounts.filter(
    (a) => a.status === "needs_reauth"
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Social Accounts</h2>
        <div className="flex items-center gap-4 text-sm">
          <span>
            <span className="font-medium">{totalActive}</span> active
          </span>
          {totalNeedsReauth > 0 && (
            <span className="text-destructive">
              <span className="font-medium">{totalNeedsReauth}</span> need
              reauth
            </span>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connect a new account</CardTitle>
        </CardHeader>
        <CardContent>
          <SocialConnectButtons
            metaConfigured={metaConfigured}
            tiktokConfigured={tiktokConfigured}
            xConfigured={xConfigured}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            One Facebook login covers every Page (and linked Instagram account)
            you administer. TikTok requires a separate login per creator
            account. X uses an app-level token, so you just add the handle.
          </p>
        </CardContent>
      </Card>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No social accounts connected yet.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Shows */}
          {grouped.show.size > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Shows</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[...grouped.show.entries()].map(([wpShowId, list]) => (
                  <ShowGroup
                    key={wpShowId}
                    title={showTitleById.get(wpShowId) ?? `Show ${wpShowId}`}
                    accounts={sortByPlatform(list)}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Hosts */}
          {grouped.host.size > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Hosts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[...grouped.host.entries()].map(([hostName, list]) => (
                  <ShowGroup
                    key={hostName}
                    title={hostName}
                    accounts={sortByPlatform(list)}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Network */}
          {grouped.network.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Network</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {sortByPlatform(grouped.network).map((account) => (
                  <SocialAccountCard key={account.id} {...account} />
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function ShowGroup({
  title,
  accounts,
}: {
  title: string;
  accounts: SocialAccountSummary[];
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="space-y-2">
        {accounts.map((account) => (
          <SocialAccountCard key={account.id} {...account} />
        ))}
      </div>
    </div>
  );
}
