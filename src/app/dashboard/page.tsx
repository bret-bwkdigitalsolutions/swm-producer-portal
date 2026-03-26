import { requireAuth } from "@/lib/auth-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const session = await requireAuth();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">
        Welcome, {session.user.name?.split(" ")[0] ?? "Producer"}
      </h2>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Recent Submissions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No submissions yet. Use the sidebar to create content.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
