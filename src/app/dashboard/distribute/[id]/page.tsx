import { requireAuth } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import { getCachedShows } from "@/lib/wordpress/cache";
import { JobDetailView } from "./job-detail-view";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DistributionJobPage({ params }: Props) {
  const { id } = await params;
  const session = await requireAuth();

  if (!session.user.hasDistributionAccess && session.user.role !== "admin") {
    redirect("/dashboard");
  }

  const job = await db.distributionJob.findUnique({
    where: { id },
    include: {
      platforms: true,
      aiSuggestions: true,
    },
  });

  if (!job) {
    notFound();
  }

  // Verify ownership
  if (job.userId !== session.user.id && session.user.role !== "admin") {
    redirect("/dashboard/distribute");
  }

  // Resolve show name
  const allShows = await getCachedShows().catch(() => []);
  const show = allShows.find((s) => s.id === job.wpShowId);
  const showName = show?.title.rendered ?? `Show #${job.wpShowId}`;

  // Serialize for the client component
  const serializedJob = {
    id: job.id,
    title: job.title,
    showName,
    status: job.status,
    metadata: job.metadata as Record<string, unknown>,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    platforms: job.platforms.map((p) => ({
      id: p.id,
      platform: p.platform,
      status: p.status,
      error: p.error,
      externalId: p.externalId,
      externalUrl: p.externalUrl,
      completedAt: p.completedAt?.toISOString() ?? null,
    })),
    aiSuggestions: job.aiSuggestions.map((s) => ({
      id: s.id,
      type: s.type,
      content: s.content,
      accepted: s.accepted,
    })),
  };

  return (
    <div className="space-y-6 py-6">
      <JobDetailView job={serializedJob} />
    </div>
  );
}
