"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { deleteFile } from "@/lib/gcs";

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

  // Reset the platform job to queued
  await db.distributionJobPlatform.update({
    where: { id: platformJobId },
    data: {
      status: "queued",
      error: null,
      completedAt: null,
    },
  });

  // If the parent job was marked as failed, set it back to processing
  const parentJob = await db.distributionJob.findUnique({
    where: { id: platformJob.job.id },
    select: { status: true },
  });

  if (parentJob?.status === "failed") {
    await db.distributionJob.update({
      where: { id: platformJob.job.id },
      data: { status: "processing" },
    });
  }

  revalidatePath(`/dashboard/distribute/${platformJob.job.id}`);

  return { success: true, message: `${platformJob.platform} job requeued.` };
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

  // Delete GCS files (video + extracted audio if present)
  if (job.gcsPath) {
    await deleteFile(job.gcsPath).catch((e) =>
      console.error("[deleteJob] Failed to delete video from GCS:", e)
    );

    const metadata = job.metadata as Record<string, unknown>;
    const audioPath = metadata?.gcsAudioPath as string | undefined;
    if (audioPath) {
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
