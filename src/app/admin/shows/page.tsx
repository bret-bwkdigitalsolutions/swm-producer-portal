import { db } from "@/lib/db";
import { getCachedShows } from "@/lib/wordpress/cache";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShowStakeholderManager } from "./stakeholder-manager";
import { ShowPlatformLinks } from "./platform-links";
import { RefreshShowsButton } from "./refresh-shows-button";
import { ShowHostsEditor } from "./show-hosts-editor";
import Link from "next/link";
import { ArrowRightLeftIcon } from "lucide-react";

export default async function AdminShowsPage() {
  const [shows, allStakeholders, allPlatformLinks, allShowMetadata] = await Promise.all([
    getCachedShows().catch(() => []),
    db.showStakeholder.findMany({
      orderBy: { name: "asc" },
    }),
    db.showPlatformLink.findMany(),
    db.showMetadata.findMany(),
  ]);

  // Map show metadata by show ID
  const metadataByShow = new Map(
    allShowMetadata.map((m) => [m.wpShowId, m])
  );

  // Group stakeholders by show ID
  const stakeholdersByShow = new Map<
    number,
    { id: string; email: string; name: string }[]
  >();
  for (const s of allStakeholders) {
    const existing = stakeholdersByShow.get(s.wpShowId) ?? [];
    existing.push({ id: s.id, email: s.email, name: s.name });
    stakeholdersByShow.set(s.wpShowId, existing);
  }

  // Group platform links by show ID
  const platformLinksByShow = new Map<
    number,
    { id: string; platform: string; url: string }[]
  >();
  for (const link of allPlatformLinks) {
    const existing = platformLinksByShow.get(link.wpShowId) ?? [];
    existing.push({ id: link.id, platform: link.platform, url: link.url });
    platformLinksByShow.set(link.wpShowId, existing);
  }

  // Network defaults use wpShowId = 0
  const networkDefaultLinks = platformLinksByShow.get(0) ?? [];
  const networkDefaults = networkDefaultLinks.map((l) => ({
    platform: l.platform,
    url: l.url,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Show Management</h2>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/shows/sync"
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ArrowRightLeftIcon className="size-4" />
            Sync from APIs
          </Link>
          <RefreshShowsButton />
          <Badge variant="secondary">{shows.length} shows</Badge>
        </div>
      </div>

      {/* Network Defaults */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span>Network Defaults</span>
            <Badge variant="outline" className="font-mono text-xs">
              Applies to all shows
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ShowPlatformLinks
            wpShowId={0}
            showName="Network Defaults"
            links={networkDefaultLinks}
          />
        </CardContent>
      </Card>

      {shows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No shows found in WordPress.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {shows.map((show) => {
            const stakeholders = stakeholdersByShow.get(show.id) ?? [];
            const platformLinks = platformLinksByShow.get(show.id) ?? [];
            const showMeta = metadataByShow.get(show.id);
            return (
              <Card key={show.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-3">
                    <span>{show.title.rendered}</span>
                    <Badge variant="outline" className="font-mono text-xs">
                      ID: {show.id}
                    </Badge>
                    {stakeholders.length > 0 && (
                      <Badge variant="secondary">
                        {stakeholders.length} stakeholder
                        {stakeholders.length !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <ShowHostsEditor
                    wpShowId={show.id}
                    currentHosts={showMeta?.hosts ?? ""}
                  />
                  <div className="border-t pt-4" />
                  <ShowStakeholderManager
                    wpShowId={show.id}
                    showName={show.title.rendered}
                    stakeholders={stakeholders}
                  />
                  <div className="border-t pt-4">
                    <ShowPlatformLinks
                      wpShowId={show.id}
                      showName={show.title.rendered}
                      links={platformLinks}
                      networkDefaults={networkDefaults}
                    />
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
