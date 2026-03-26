import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { ContentType, CONTENT_TYPE_LABELS, type ContentTypeValue } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { updateUserPermissions, deleteUser } from "../actions";

const ALL_CONTENT_TYPES = Object.values(ContentType);

export default async function UserEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;

  const user = await db.user.findUnique({
    where: { id },
    include: {
      allowedContentTypes: true,
      allowedShows: true,
    },
  });

  if (!user) notFound();

  const allowedTypes = user.allowedContentTypes.map((ct) => ct.contentType);
  const allowedShowIds = user.allowedShows.map((s) => s.wpShowId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Edit User</h2>
          <p className="text-sm text-muted-foreground">
            {user.name ?? "Unnamed"} ({user.email})
          </p>
        </div>
        <Button variant="outline" render={<Link href="/admin/users" />}>
          Back to Users
        </Button>
      </div>

      {saved && (
        <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
          User permissions updated successfully.
        </div>
      )}

      <form action={updateUserPermissions}>
        <input type="hidden" name="userId" value={user.id} />

        <Card>
          <CardHeader>
            <CardTitle>Permissions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Role */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Role</Label>
              <div className="flex gap-4">
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name="role"
                    value="producer"
                    defaultChecked={user.role === "producer"}
                    className="text-primary"
                  />
                  <span className="text-sm">Producer</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name="role"
                    value="admin"
                    defaultChecked={user.role === "admin"}
                    className="text-primary"
                  />
                  <span className="text-sm">Admin</span>
                </label>
              </div>
            </div>

            {/* Distribution Access */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Distribution Access</Label>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  name="hasDistributionAccess"
                  defaultChecked={user.hasDistributionAccess}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">
                  Allow this user to distribute episodes to external platforms
                </span>
              </label>
            </div>

            {/* Content Types */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Allowed Content Types
              </Label>
              <p className="text-xs text-muted-foreground">
                Select which content types this user can access.
              </p>
              <div className="space-y-2">
                {ALL_CONTENT_TYPES.map((type) => (
                  <label key={type} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      name="contentTypes"
                      value={type}
                      defaultChecked={allowedTypes.includes(type)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">
                      {CONTENT_TYPE_LABELS[type as ContentTypeValue]}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Show Access */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Allowed Shows</Label>
              <p className="text-xs text-muted-foreground">
                Enter WordPress show IDs this user can access (one per line).
                Show names will be resolved from WordPress in a future update.
              </p>
              <div className="space-y-2">
                {allowedShowIds.map((showId) => (
                  <div key={showId} className="flex items-center gap-2">
                    <input
                      type="hidden"
                      name="showIds"
                      value={showId.toString()}
                    />
                    <Badge variant="outline">Show #{showId}</Badge>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <Input
                    name="newShowId"
                    type="number"
                    placeholder="Add show ID..."
                    className="w-40"
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter a new show ID and save to add it
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <Button type="submit">Save Permissions</Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Delete User */}
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-600">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Permanently delete this user and all their associated data. This
            action cannot be undone.
          </p>
          <form action={deleteUser}>
            <input type="hidden" name="userId" value={user.id} />
            <Button type="submit" variant="destructive">
              Delete User
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
