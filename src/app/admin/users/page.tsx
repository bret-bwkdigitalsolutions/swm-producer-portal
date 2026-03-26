import Link from "next/link";
import { db } from "@/lib/db";
import { CONTENT_TYPE_LABELS } from "@/lib/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteUserDialog } from "./invite-user-dialog";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string; deleted?: string }>;
}) {
  const { invited, deleted } = await searchParams;

  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      allowedContentTypes: true,
      allowedShows: true,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">User Management</h2>
        <InviteUserDialog />
      </div>

      {invited && (
        <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
          User invited successfully.
        </div>
      )}

      {deleted && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
          User deleted successfully.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Users ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Content Types</TableHead>
                <TableHead>Shows</TableHead>
                <TableHead>Distribution</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    {user.name ?? "—"}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        user.role === "admin" ? "default" : "secondary"
                      }
                    >
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.allowedContentTypes.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          None
                        </span>
                      ) : (
                        user.allowedContentTypes.map((ct) => (
                          <Badge key={ct.id} variant="outline">
                            {CONTENT_TYPE_LABELS[
                              ct.contentType as keyof typeof CONTENT_TYPE_LABELS
                            ] ?? ct.contentType}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {user.allowedShows.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        None
                      </span>
                    ) : (
                      <span className="text-sm">
                        {user.allowedShows.map((s) => `#${s.wpShowId}`).join(", ")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.hasDistributionAccess ? (
                      <Badge variant="default">Yes</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">No</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" render={<Link href={`/admin/users/${user.id}`} />}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No users found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
