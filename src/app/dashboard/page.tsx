import { Suspense } from "react";
import { requireAuth } from "@/lib/auth-guard";
import {
  RecentSubmissions,
  RecentSubmissionsSkeleton,
} from "@/components/dashboard/recent-submissions";

export default async function DashboardPage() {
  const session = await requireAuth();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">
        Welcome, {session.user.name?.split(" ")[0] ?? "Producer"}
      </h2>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Suspense fallback={<RecentSubmissionsSkeleton />}>
          <RecentSubmissions userId={session.user.id} />
        </Suspense>
      </div>
    </div>
  );
}
