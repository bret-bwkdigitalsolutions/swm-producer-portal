import { requireAuth } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { CONTENT_TYPE_LABELS } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { updateVisibilityPreferences } from "./actions";

export default async function SettingsPage() {
  const session = await requireAuth();

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      allowedContentTypes: true,
      allowedShows: true,
      preferences: true,
    },
  });

  if (!user) throw new Error("User not found");

  const allowedTypes = user.allowedContentTypes.map((ct) => ct.contentType);
  const visibleTypes =
    user.preferences?.visibleContentTypes ?? allowedTypes;
  const allowedShowIds = user.allowedShows.map((s) => s.wpShowId);
  const visibleShowIds =
    user.preferences?.visibleShowIds ?? allowedShowIds;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h2 className="text-2xl font-bold">Settings</h2>

      <form action={updateVisibilityPreferences}>
        <Card>
          <CardHeader>
            <CardTitle>Dashboard Visibility</CardTitle>
            <p className="text-sm text-muted-foreground">
              Choose which content types appear on your dashboard. You can only
              see types your admin has enabled for you.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Content Types</p>
              {allowedTypes.map((type) => (
                <label key={type} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    name="contentTypes"
                    value={type}
                    defaultChecked={visibleTypes.includes(type)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">
                    {CONTENT_TYPE_LABELS[
                      type as keyof typeof CONTENT_TYPE_LABELS
                    ] ?? type}
                  </span>
                </label>
              ))}
              {allowedTypes.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No content types have been assigned to you yet. Contact your
                  admin.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Shows</p>
              {allowedShowIds.map((showId) => (
                <label key={showId} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    name="shows"
                    value={showId.toString()}
                    defaultChecked={visibleShowIds.includes(showId)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">Show #{showId}</span>
                </label>
              ))}
              {allowedShowIds.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No shows have been assigned to you yet. Contact your admin.
                </p>
              )}
            </div>

            <Button type="submit">Save Preferences</Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
