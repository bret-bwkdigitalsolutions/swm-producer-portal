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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 20;

export default async function ActivityLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const currentPage = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const [entries, totalCount] = await Promise.all([
    db.activityLog.findMany({
      take: PAGE_SIZE,
      skip: (currentPage - 1) * PAGE_SIZE,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true, email: true } },
      },
    }),
    db.activityLog.count(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Activity Log</h2>

      <Card>
        <CardHeader>
          <CardTitle>
            All Activity ({totalCount} total)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Content Type</TableHead>
                <TableHead>Show</TableHead>
                <TableHead>Post ID</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">
                    {entry.user.name ?? entry.user.email}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        entry.action === "create"
                          ? "default"
                          : entry.action === "distribute"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {entry.action}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {entry.contentType
                      ? (CONTENT_TYPE_LABELS[
                          entry.contentType as keyof typeof CONTENT_TYPE_LABELS
                        ] ?? entry.contentType)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {entry.wpShowId ? `#${entry.wpShowId}` : "—"}
                  </TableCell>
                  <TableCell>
                    {entry.wpPostId ? `#${entry.wpPostId}` : "—"}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {entry.details ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.createdAt.toLocaleDateString()}{" "}
                    {entry.createdAt.toLocaleTimeString()}
                  </TableCell>
                </TableRow>
              ))}
              {entries.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-muted-foreground"
                  >
                    No activity recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex gap-2">
                {currentPage > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    render={
                      <Link
                        href={`/admin/activity?page=${currentPage - 1}`}
                      />
                    }
                  >
                    Previous
                  </Button>
                )}
                {currentPage < totalPages && (
                  <Button
                    variant="outline"
                    size="sm"
                    render={
                      <Link
                        href={`/admin/activity?page=${currentPage + 1}`}
                      />
                    }
                  >
                    Next
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
