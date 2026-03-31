import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { ContentType, CONTENT_TYPE_LABELS, type ContentTypeValue } from "@/lib/constants";
import { getCachedShows } from "@/lib/wordpress/cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { updateUserPermissions, deleteUser, sendInvite } from "../actions";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";

const ALL_CONTENT_TYPES = Object.values(ContentType);

export default async function UserEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; invited?: string }>;
}) {
  const { id } = await params;
  const { saved, invited } = await searchParams;

  const user = await db.user.findUnique({
    where: { id },
    include: {
      allowedContentTypes: true,
      allowedShows: true,
      inviteToken: true,
      accounts: { select: { provider: true } },
    },
  });

  if (!user) notFound();

  const allowedTypes = user.allowedContentTypes.map((ct) => ct.contentType);
  const allowedShowIds = new Set(user.allowedShows.map((s) => s.wpShowId));
  const allShows = await getCachedShows().catch(() => []);

  function decodeHtml(html: string): string {
    return html.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Edit User</h2>
          <p className="text-sm text-muted-foreground">
            {user.name ?? "Unnamed"} ({user.email})
          </p>
          <p className="text-xs text-muted-foreground">
            Last login:{" "}
            {user.lastLoginAt
              ? user.lastLoginAt.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "Never"}
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

      {invited && (
        <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
          Invite email sent successfully.
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
                {ALL_CONTENT_TYPES.filter((type) => type !== ContentType.EPISODE).map((type) => (
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
                Select which shows this user can access.
              </p>
              <div className="space-y-2">
                {allShows.map((show) => (
                  <label key={show.id} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      name="showIds"
                      value={show.id.toString()}
                      defaultChecked={allowedShowIds.has(show.id)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">{decodeHtml(show.title.rendered)}</span>
                  </label>
                ))}
                {allShows.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No shows found in WordPress.
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <Button type="submit">Save Permissions</Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Invite */}
      <Card>
        <CardHeader>
          <CardTitle>Invite</CardTitle>
        </CardHeader>
        <CardContent>
          {user.accounts.some((a) => a.provider === "google") ? (
            <p className="text-sm text-muted-foreground">
              This user has signed in with Google. No invite needed.
            </p>
          ) : user.inviteToken?.usedAt ? (
            <p className="text-sm text-muted-foreground">
              Invite accepted on{" "}
              {user.inviteToken.usedAt.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
              .
            </p>
          ) : user.inviteSentAt ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Invite sent on{" "}
                {user.inviteSentAt.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                .
                {user.inviteToken &&
                  user.inviteToken.expiresAt < new Date() && (
                    <span className="text-red-600 font-medium">
                      {" "}
                      Link expired.
                    </span>
                  )}
              </p>
              <form action={sendInvite}>
                <input type="hidden" name="userId" value={user.id} />
                <Button type="submit" variant="outline" size="sm">
                  Resend Invite
                </Button>
              </form>
            </div>
          ) : (
            <div className="space-y-3">
              {user.allowedContentTypes.length === 0 && (
                <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md p-2">
                  This user has no content types assigned yet. Consider
                  configuring permissions above before sending the invite.
                </p>
              )}
              <form action={sendInvite}>
                <input type="hidden" name="userId" value={user.id} />
                <Button type="submit" size="sm">
                  Send Invite
                </Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>

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
          <ConfirmDeleteButton action={deleteUser} userId={user.id} />
        </CardContent>
      </Card>
    </div>
  );
}
