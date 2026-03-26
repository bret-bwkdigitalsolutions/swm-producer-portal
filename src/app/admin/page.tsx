import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CONTENT_TYPE_LABELS } from "@/lib/constants";

export default async function AdminDashboardPage() {
  const [userCount, recentActivity] = await Promise.all([
    db.user.count(),
    db.activityLog.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  const adminCount = await db.user.count({ where: { role: "admin" } });
  const producerCount = userCount - adminCount;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Admin Overview</h2>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{userCount}</p>
            <p className="text-xs text-muted-foreground">
              {adminCount} admin{adminCount !== 1 ? "s" : ""}, {producerCount}{" "}
              producer{producerCount !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{recentActivity.length}</p>
            <p className="text-xs text-muted-foreground">
              entries in latest batch
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No activity recorded yet.
            </p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between border-b pb-2 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {entry.user.name ?? entry.user.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entry.action}
                      {entry.contentType
                        ? ` - ${CONTENT_TYPE_LABELS[entry.contentType as keyof typeof CONTENT_TYPE_LABELS] ?? entry.contentType}`
                        : ""}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {entry.createdAt.toLocaleDateString()}{" "}
                    {entry.createdAt.toLocaleTimeString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
