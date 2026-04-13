import { requireAuth } from "@/lib/auth-guard";
import { getCachedShows } from "@/lib/wordpress/cache";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { DistributionForm } from "./distribution-form";

export default async function NewDistributionPage() {
  const session = await requireAuth();

  if (!session.user.hasDistributionAccess && session.user.role !== "admin") {
    redirect("/dashboard");
  }

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

  const showIds = allowedShows.map((s) => s.id);
  const showMetadataList = await db.showMetadata.findMany({
    where: { wpShowId: { in: showIds } },
    select: { wpShowId: true, descriptionFooter: true },
  });
  const footerMap: Record<string, string> = {};
  for (const sm of showMetadataList) {
    if (sm.descriptionFooter) {
      footerMap[String(sm.wpShowId)] = sm.descriptionFooter;
    }
  }

  // Compute top-12 frequent tags per show from past distribution jobs
  const pastJobs = await db.distributionJob.findMany({
    where: {
      wpShowId: { in: showIds.map(Number) },
      status: { not: "uploading" },
    },
    select: { wpShowId: true, metadata: true },
  });

  const frequentTagsMap: Record<string, string[]> = {};
  for (const showId of showIds) {
    const tagCounts: Record<string, number> = {};
    for (const job of pastJobs) {
      if (String(job.wpShowId) !== String(showId)) continue;
      const meta = job.metadata as Record<string, unknown>;
      const tags = meta.tags;
      if (!Array.isArray(tags)) continue;
      for (const tag of tags as string[]) {
        if (typeof tag === "string" && tag.trim()) {
          tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
        }
      }
    }
    frequentTagsMap[showId] = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag]) => tag);
  }

  const shows = allowedShows.map((show) => ({
    id: String(show.id),
    title: show.title.rendered,
  }));

  return (
    <div className="py-6">
      <DistributionForm
        shows={shows}
        descriptionFooters={footerMap}
        frequentTags={frequentTagsMap}
      />
    </div>
  );
}
