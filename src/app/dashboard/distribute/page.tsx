import Link from "next/link";
import { requireAuth } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { getCachedShows } from "@/lib/wordpress/cache";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";
import type { DistributionJobSummary } from "@/components/distribution/job-card";
import {
  GroupedJobList,
  type DayGroup,
} from "@/components/distribution/grouped-job-list";

export default async function DistributePage() {
  const session = await requireAuth();

  // Only users with distribution access can view this page
  if (!session.user.hasDistributionAccess && session.user.role !== "admin") {
    redirect("/dashboard");
  }

  // Fetch the user's allowed shows so we can resolve show names
  const allShows = await getCachedShows().catch(() => []);
  let allowedShows;
  if (session.user.role === "admin") {
    allowedShows = allShows;
  } else {
    const userShowAccess = await db.userShowAccess.findMany({
      where: { userId: session.user.id },
      select: { wpShowId: true },
    });
    const allowedIds = new Set(userShowAccess.map((a) => a.wpShowId));
    allowedShows = allShows.filter((show) => allowedIds.has(show.id));
  }

  const showNameMap = new Map(
    allowedShows.map((s) => [s.id, s.title.rendered])
  );

  // Fetch recent distribution jobs — admins see all, producers see their own
  const jobs = await db.distributionJob.findMany({
    where:
      session.user.role === "admin" ? {} : { userId: session.user.id },
    include: {
      platforms: {
        select: {
          id: true,
          platform: true,
          status: true,
          error: true,
          externalUrl: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const jobSummaries: DistributionJobSummary[] = jobs.map((job) => ({
    id: job.id,
    title: job.title,
    showName: showNameMap.get(job.wpShowId) ?? `Show #${job.wpShowId}`,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    platforms: job.platforms,
  }));

  // Group jobs by day
  const dayGroups: DayGroup[] = [];
  const dayMap = new Map<string, DistributionJobSummary[]>();
  for (const job of jobSummaries) {
    const dayLabel = new Date(job.createdAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    if (!dayMap.has(dayLabel)) {
      dayMap.set(dayLabel, []);
      dayGroups.push({ date: dayLabel, jobs: dayMap.get(dayLabel)! });
    }
    dayMap.get(dayLabel)!.push(job);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Episode Distribution</h2>
          <p className="text-sm text-muted-foreground">
            Upload and distribute episodes to all your platforms at once.
          </p>
        </div>
        <Link href="/dashboard/distribute/new">
          <Button>
            <PlusIcon className="size-4" />
            New Distribution
          </Button>
        </Link>
      </div>

      {dayGroups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <p className="text-muted-foreground">
            No distribution jobs yet. Start by uploading an episode.
          </p>
          <Link href="/dashboard/distribute/new">
            <Button variant="outline">
              <PlusIcon className="size-4" />
              Create your first distribution
            </Button>
          </Link>
        </div>
      ) : (
        <GroupedJobList groups={dayGroups} />
      )}
    </div>
  );
}
