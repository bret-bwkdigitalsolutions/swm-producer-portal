"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { deleteFile } from "@/lib/gcs";
import { processJob } from "@/lib/jobs/processor";
import { dispatchVideoProcessing } from "@/lib/jobs/cloud-run-dispatch";
import { getProcessingRuntime } from "@/lib/jobs/processing-runtime";
import { OG_PREMIUM_SECTION, OG_WP_SHOW_ID, showOffersOg } from "@/lib/og-episode";
import { getShow } from "@/lib/wordpress/client";

interface FormState {
  success?: boolean;
  message?: string;
}

export async function updateAiSuggestion(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const suggestionId = formData.get("suggestion_id") as string | null;
  const action = formData.get("action") as string | null; // "accept" | "reject"
  const editedContent = formData.get("edited_content") as string | null;

  if (!suggestionId || !action) {
    return { success: false, message: "Missing required fields." };
  }

  if (action !== "accept" && action !== "reject") {
    return { success: false, message: "Invalid action." };
  }

  // Verify the suggestion belongs to a job owned by this user
  const suggestion = await db.aiSuggestion.findUnique({
    where: { id: suggestionId },
    include: { job: { select: { userId: true, id: true } } },
  });

  if (!suggestion) {
    return { success: false, message: "Suggestion not found." };
  }

  if (
    suggestion.job.userId !== session.user.id &&
    session.user.role !== "admin"
  ) {
    return { success: false, message: "You do not have access to this job." };
  }

  // Update the suggestion
  await db.aiSuggestion.update({
    where: { id: suggestionId },
    data: {
      accepted: action === "accept",
      // If accepting and content was edited, save the edited version
      ...(action === "accept" && editedContent
        ? { content: editedContent.trim() }
        : {}),
    },
  });

  // Check if all suggestions for this job have been reviewed
  const remaining = await db.aiSuggestion.findMany({
    where: { jobId: suggestion.job.id },
  });

  const allReviewed = remaining.every(
    (s) => s.id === suggestionId || s.accepted !== false
  );

  // If the job is in awaiting_review and all suggestions reviewed, move to completed
  if (allReviewed) {
    const job = await db.distributionJob.findUnique({
      where: { id: suggestion.job.id },
      select: { status: true },
    });
    if (job?.status === "awaiting_review") {
      await db.distributionJob.update({
        where: { id: suggestion.job.id },
        data: { status: "completed" },
      });
    }
  }

  revalidatePath(`/dashboard/distribute/${suggestion.job.id}`);

  return {
    success: true,
    message: `Suggestion ${action === "accept" ? "accepted" : "rejected"}.`,
  };
}

export async function retryPlatform(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const platformJobId = formData.get("platform_job_id") as string | null;

  if (!platformJobId) {
    return { success: false, message: "Missing platform job ID." };
  }

  // Verify ownership
  const platformJob = await db.distributionJobPlatform.findUnique({
    where: { id: platformJobId },
    include: { job: { select: { userId: true, id: true } } },
  });

  if (!platformJob) {
    return { success: false, message: "Platform job not found." };
  }

  if (
    platformJob.job.userId !== session.user.id &&
    session.user.role !== "admin"
  ) {
    return { success: false, message: "You do not have access to this job." };
  }

  if (platformJob.status !== "failed") {
    return {
      success: false,
      message: "Only failed platform jobs can be retried.",
    };
  }

  // Atomically reset the platform job to queued. The status guard in the
  // WHERE clause means a concurrent retry (double-click, second admin) gets
  // count 0 and bails instead of spawning a duplicate upload pipeline.
  const claimed = await db.distributionJobPlatform.updateMany({
    where: { id: platformJobId, status: "failed" },
    data: {
      status: "queued",
      error: null,
      completedAt: null,
    },
  });
  if (claimed.count === 0) {
    return { success: false, message: "This platform is already being retried." };
  }

  // Set the parent job back to pending so processJob can pick it up — but
  // only if a pipeline isn't already running. If one is, don't spawn a
  // second (duplicate uploads); the queued platform stays retryable.
  const parentClaim = await db.distributionJob.updateMany({
    where: { id: platformJob.job.id, status: { not: "processing" } },
    data: { status: "pending" },
  });

  if (parentClaim.count > 0) {
    if (getProcessingRuntime() === "cloudrun") {
      await db.distributionJob.update({
        where: { id: platformJob.job.id },
        data: { status: "processing" },
      });
      try {
        await dispatchVideoProcessing(platformJob.job.id, "process");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not start Cloud Run processing.";
        console.error(
          `[retry] Cloud Run dispatch failed for job ${platformJob.job.id}:`,
          error
        );
        await db.distributionJob.update({
          where: { id: platformJob.job.id },
          data: { status: "failed", errorMessage: message.slice(0, 4000) },
        });
        return {
          success: false,
          message: "Could not start video processing. Try again.",
        };
      }
    } else {
      // Trigger processing (non-blocking) — processor skips completed platforms
      processJob(platformJob.job.id).catch((error) => {
        console.error(`[retry] Processing failed for job ${platformJob.job.id}:`, error);
      });
    }
  }

  revalidatePath(`/dashboard/distribute/${platformJob.job.id}`);

  return { success: true, message: `Retrying ${platformJob.platform}...` };
}

/**
 * Mark a failed website publish as The OG and run it again.
 * Used for jobs created before the members-only path existed, including
 * OG #27 (job cmwiub4z6000c02p7rfl6bixt).
 */
export async function retryWebsiteAsOg(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const platformJobId = formData.get("platform_job_id") as string | null;
  if (!platformJobId) {
    return { success: false, message: "Missing platform job ID." };
  }

  const platformJob = await db.distributionJobPlatform.findUnique({
    where: { id: platformJobId },
    include: {
      job: {
        select: { userId: true, id: true, wpShowId: true, metadata: true, status: true },
      },
    },
  });

  if (!platformJob) {
    return { success: false, message: "Platform job not found." };
  }
  if (
    platformJob.job.userId !== session.user.id &&
    session.user.role !== "admin"
  ) {
    return { success: false, message: "You do not have access to this job." };
  }
  if (platformJob.platform !== "website" || platformJob.status !== "failed") {
    return { success: false, message: "Only a failed website publish can be retried as The OG." };
  }
  if (!(await showCanPublishOg(platformJob.job.wpShowId))) {
    return { success: false, message: "The OG is only available on Your Dark Companion." };
  }

  const metadata = {
    ...((platformJob.job.metadata as Record<string, unknown>) ?? {}),
    premiumSection: OG_PREMIUM_SECTION,
    isPremium: false,
  };

  await db.$transaction(async (tx) => {
    await tx.distributionJob.update({
      where: { id: platformJob.job.id },
      data: {
        isPremium: false,
        metadata: JSON.parse(JSON.stringify(metadata)),
      },
    });
    await tx.distributionJobPlatform.deleteMany({
      where: {
        jobId: platformJob.job.id,
        platform: { not: "website" },
        status: { not: "completed" },
      },
    });
    await tx.distributionJobPlatform.update({
      where: { id: platformJobId },
      data: { status: "queued", error: null, completedAt: null },
    });
  });

  const parentClaim = await db.distributionJob.updateMany({
    where: { id: platformJob.job.id, status: { not: "processing" } },
    data: { status: "pending", errorMessage: null },
  });

  if (parentClaim.count > 0) {
    const started = await startDistributionProcessing(platformJob.job.id);
    if (!started.ok) {
      return { success: false, message: started.message };
    }
  }

  revalidatePath(`/dashboard/distribute/${platformJob.job.id}`);
  return { success: true, message: "Retrying as The OG..." };
}

async function showCanPublishOg(wpShowId: number): Promise<boolean> {
  if (wpShowId === OG_WP_SHOW_ID) return true;
  try {
    const show = await getShow(wpShowId);
    return showOffersOg({ id: show.id, title: show.title.rendered });
  } catch (error) {
    console.error("[distribute] Could not confirm the show for The OG:", error);
    return false;
  }
}

async function startDistributionProcessing(
  jobId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (getProcessingRuntime() === "cloudrun") {
    await db.distributionJob.update({
      where: { id: jobId },
      data: { status: "processing" },
    });
    try {
      await dispatchVideoProcessing(jobId, "process");
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not start Cloud Run processing.";
      console.error(`[retry] Cloud Run dispatch failed for job ${jobId}:`, error);
      await db.distributionJob.update({
        where: { id: jobId },
        data: { status: "failed", errorMessage: message.slice(0, 4000) },
      });
      return { ok: false, message: "Could not start video processing. Try again." };
    }
  }

  processJob(jobId).catch((error) => {
    console.error(`[retry] Processing failed for job ${jobId}:`, error);
  });
  return { ok: true };
}

/**
 * Delete a distribution job, its platform records, AI suggestions, and GCS files.
 */
export async function deleteJob(jobId: string): Promise<FormState> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, gcsPath: true, metadata: true },
  });

  if (!job) {
    return { success: false, message: "Job not found." };
  }

  if (job.userId !== session.user.id && session.user.role !== "admin") {
    return { success: false, message: "You do not have access to this job." };
  }

  const metadata = (job.metadata as Record<string, unknown>) ?? {};
  const bucket =
    typeof metadata.gcsBucket === "string" && metadata.gcsBucket.trim()
      ? metadata.gcsBucket.trim()
      : undefined;

  // Delete GCS files (video + extracted audio if present).
  // A stored bucket hint deletes that object. With no hint, deleteFile
  // removes the key from both buckets while dual-read is configured.
  if (job.gcsPath) {
    await deleteFile(job.gcsPath, bucket).catch((e) =>
      console.error("[deleteJob] Failed to delete video from GCS:", e)
    );

    const audioPath = metadata.gcsAudioPath as string | undefined;
    if (audioPath) {
      // Do not pass the video bucket. The mp3 is on the regional bucket
      // (and an older copy may still be on the legacy bucket). With no
      // hint, deleteFile removes the key from both.
      await deleteFile(audioPath).catch((e) =>
        console.error("[deleteJob] Failed to delete audio from GCS:", e)
      );
    }
  }

  // Delete related records then the job itself
  await db.$transaction(async (tx) => {
    await tx.aiSuggestion.deleteMany({ where: { jobId } });
    await tx.distributionJobPlatform.deleteMany({ where: { jobId } });
    await tx.distributionJob.delete({ where: { id: jobId } });
  });

  redirect("/dashboard/distribute");
}
