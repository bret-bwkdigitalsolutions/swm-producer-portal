import { db } from "@/lib/db";
import { getCachedShows } from "@/lib/wordpress/cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShowStakeholderManager } from "./stakeholder-manager";

export default async function AdminShowsPage() {
  const [shows, allStakeholders] = await Promise.all([
    getCachedShows(),
    db.showStakeholder.findMany({
      orderBy: { name: "asc" },
    }),
  ]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Show Management</h2>
        <Badge variant="secondary">{shows.length} shows</Badge>
      </div>

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
                <CardContent>
                  <ShowStakeholderManager
                    wpShowId={show.id}
                    showName={show.title.rendered}
                    stakeholders={stakeholders}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
