import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { extractAudio } from "@/lib/jobs/audio-extractor";
import { transcribeAudio, formatTranscriptForAI } from "@/lib/transcription";
import { generateAiSuggestions } from "@/lib/jobs/ai-processor";
import { downloadVideoToGcs } from "@/lib/jobs/video-downloader";
import { getRecentEpisodeTitles, getLatestEpisodeNumbers, getShow } from "@/lib/wordpress/client";

// Map raw yt-dlp / pipeline errors to a user-actionable message. "Sign in to
// confirm" and "cookies" both point at a missing/expired/untrusted session.
// "Requested format is not available" is what yt-dlp returns when YouTube
// served no usable audio formats — usually a still-processing live VOD, a
// gated video, or (per past incident) an empty YOUTUBE_COOKIES env making
// YouTube downgrade the player response on datacenter IPs.
function friendlyAnalyzeError(raw: string): string {
  if (raw.includes("Sign in to confirm") || raw.includes("cookies")) {
    return "YouTube download failed — authentication cookies have expired or are missing. Please contact an admin to refresh them, or use a Vimeo URL instead.";
  }
  if (raw.includes("Requested format is not available")) {
    return "YouTube download failed — no downloadable audio was offered for this video. It may still be processing after the livestream, be members-only/age-gated for the configured account, or the YouTube cookies on the server may be empty or malformed. Try again in a bit, or contact an admin.";
  }
  return raw;
}

type AnalyzeState = {
  state: "running" | "complete" | "failed";
  step?: string;
  error?: string;
  startedAt?: string;
  episodeNumber?: number | null;
  seasonNumber?: number | null;
};

/** Merge analyze progress into job metadata without clobbering other keys. */
async function setAnalyzeState(jobId: string, analyze: AnalyzeState) {
  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    select: { metadata: true },
  });
  const metadata = (job?.metadata as Record<string, unknown>) ?? {};
  await db.distributionJob.update({
    where: { id: jobId },
    data: { metadata: { ...metadata, analyze: JSON.parse(JSON.stringify(analyze)) } },
  });
}

/**
 * The full analysis pipeline, run in the background (fire-and-forget from the
 * POST handler). Progress and the final result are persisted to job metadata
 * so the client can poll GET /api/distribute/analyze?jobId=...
 *
 * This used to run inside the POST request, but Vimeo/YouTube downloads plus
 * transcription routinely exceed Railway's edge proxy timeout — the proxy
 * then returns a plain-text "upstream error" page that broke the client.
 */
async function runAnalysis(jobId: string, startState: AnalyzeState) {
  try {
    const job = await db.distributionJob.findUnique({
      where: { id: jobId },
      select: { gcsPath: true, metadata: true, wpShowId: true },
    });
    if (!job) throw new Error("Job disappeared during analysis.");

    // For URL-sourced episodes (YouTube or Vimeo): download the audio to GCS
    // if not already done.
    let gcsPath = job.gcsPath;
    if (!gcsPath) {
      const jobMeta = job.metadata as Record<string, unknown>;
      const sourceUrl =
        (jobMeta.existingVimeoUrl as string | undefined) ??
        (jobMeta.existingYoutubeUrl as string | undefined);
      if (!sourceUrl) {
        throw new Error("No video uploaded.");
      }
      await setAnalyzeState(jobId, { ...startState, step: "downloading" });
      console.log(`[analyze] Downloading source video for job ${jobId}`);
      gcsPath = await downloadVideoToGcs(sourceUrl, jobId, job.wpShowId);
      await db.distributionJob.update({
        where: { id: jobId },
        data: { gcsPath },
      });
    }

    // 1. Extract audio
    await setAnalyzeState(jobId, { ...startState, step: "extracting" });
    console.log(`[analyze] Extracting audio for job ${jobId}`);
    const gcsAudioPath = await extractAudio(gcsPath);

    // 2. Transcribe
    await setAnalyzeState(jobId, { ...startState, step: "transcribing" });
    console.log(`[analyze] Transcribing audio for job ${jobId}`);
    const transcription = await transcribeAudio(gcsAudioPath);
    const formattedTranscript = formatTranscriptForAI(transcription.segments);

    // Store transcript in job metadata (re-read metadata to avoid clobbering
    // the analyze progress writes above)
    const freshJob = await db.distributionJob.findUnique({
      where: { id: jobId },
      select: { metadata: true },
    });
    const metadata = (freshJob?.metadata as Record<string, unknown>) ?? {};
    await db.distributionJob.update({
      where: { id: jobId },
      data: {
        metadata: {
          ...metadata,
          transcript: transcription.fullText,
          transcriptLanguage: transcription.language,
          audioDuration: transcription.duration,
          gcsAudioPath,
        },
      },
    });

    // 3. Fetch show context for title generation
    const [recentTitles, epNumbers, show] = await Promise.all([
      getRecentEpisodeTitles(job.wpShowId),
      getLatestEpisodeNumbers(job.wpShowId),
      getShow(job.wpShowId).catch(() => null),
    ]);
    const nextEpisodeNumber = epNumbers.episodeNumber != null ? epNumbers.episodeNumber + 1 : null;
    const seasonNumber = epNumbers.seasonNumber;
    const showName = show?.title.rendered ?? undefined;

    // 4. Generate AI suggestions (including title)
    await setAnalyzeState(jobId, { ...startState, step: "generating" });
    console.log(`[analyze] Generating AI suggestions for job ${jobId}`);
    await generateAiSuggestions(
      jobId,
      formattedTranscript,
      transcription.language,
      undefined,
      recentTitles,
      showName
    );

    await setAnalyzeState(jobId, {
      state: "complete",
      startedAt: startState.startedAt,
      episodeNumber: nextEpisodeNumber,
      seasonNumber,
    });
    console.log(`[analyze] Analysis complete for job ${jobId}`);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Analysis failed";
    console.error(`[analyze] Failed for job ${jobId}:`, error);

    // Mark the job as failed AND persist the error so post-mortems don't
    // require Railway log access (logs rotate aggressively).
    await db.distributionJob.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: rawMessage.slice(0, 4000) },
    }).catch((e) => console.error(`[analyze] Failed to mark job ${jobId} as failed:`, e));

    await setAnalyzeState(jobId, {
      state: "failed",
      startedAt: startState.startedAt,
      error: friendlyAnalyzeError(rawMessage),
    }).catch((e) => console.error(`[analyze] Failed to record failure for job ${jobId}:`, e));
  }
}

async function loadAuthorizedJob(jobId: string) {
  const session = await auth();
  if (!session?.user) {
    return { errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, gcsPath: true, metadata: true, wpShowId: true },
  });
  if (!job) {
    return { errorResponse: NextResponse.json({ error: "Job not found." }, { status: 404 }) };
  }
  if (job.userId !== session.user.id && session.user.role !== "admin") {
    return { errorResponse: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
  }
  return { job };
}

/**
 * POST /api/distribute/analyze
 *
 * Starts the AI analysis pipeline for a distribution job in the background:
 * 1. Download source video if URL-sourced (YouTube/Vimeo)
 * 2. Extract audio from video
 * 3. Transcribe via Deepgram
 * 4. Generate AI suggestions (summary, chapters, blog ideas)
 *
 * Returns 202 immediately; the client polls GET with the jobId for progress
 * and results. (The pipeline can run for many minutes — far past the edge
 * proxy timeout — so it must not block the HTTP response.)
 */
export async function POST(request: NextRequest) {
  let body: { jobId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { jobId } = body;
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  }

  const { job, errorResponse } = await loadAuthorizedJob(jobId);
  if (errorResponse) return errorResponse;

  const meta = (job.metadata as Record<string, unknown>) ?? {};
  const existing = meta.analyze as AnalyzeState | undefined;
  if (existing?.state === "running") {
    // Already in flight (e.g. user retried after a transient client error) —
    // don't start a second pipeline, just let the client resume polling.
    return NextResponse.json({ started: true, resumed: true }, { status: 202 });
  }

  if (!job.gcsPath && !meta.existingVimeoUrl && !meta.existingYoutubeUrl) {
    return NextResponse.json({ error: "No video uploaded." }, { status: 400 });
  }

  const startState: AnalyzeState = {
    state: "running",
    step: "starting",
    startedAt: new Date().toISOString(),
  };
  await setAnalyzeState(jobId, startState);

  // Fire-and-forget — same pattern as processJob in /api/upload/confirm.
  runAnalysis(jobId, startState).catch((error) => {
    console.error(`[analyze] Background analysis crashed for job ${jobId}:`, error);
  });

  return NextResponse.json({ started: true }, { status: 202 });
}

/**
 * GET /api/distribute/analyze?jobId=...
 *
 * Polling endpoint for analysis progress. While running, returns the current
 * step; when complete, returns the transcript, AI suggestions, and episode
 * numbering the form needs to populate itself.
 */
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  }

  const { job, errorResponse } = await loadAuthorizedJob(jobId);
  if (errorResponse) return errorResponse;

  const meta = (job.metadata as Record<string, unknown>) ?? {};
  const analyze = meta.analyze as AnalyzeState | undefined;

  if (!analyze) {
    return NextResponse.json({ state: "none" });
  }

  if (analyze.state === "failed") {
    return NextResponse.json({ state: "failed", error: analyze.error ?? "Analysis failed" });
  }

  if (analyze.state === "running") {
    return NextResponse.json({ state: "running", step: analyze.step ?? "starting" });
  }

  // Complete — assemble the same payload the old synchronous response had.
  const suggestions = await db.aiSuggestion.findMany({
    where: { jobId },
    select: { id: true, type: true, content: true, accepted: true },
  });

  return NextResponse.json({
    state: "complete",
    success: true,
    transcript: (meta.transcript as string) ?? "",
    language: (meta.transcriptLanguage as string) ?? null,
    duration: (meta.audioDuration as number) ?? null,
    suggestions,
    episodeNumber: analyze.episodeNumber ?? null,
    seasonNumber: analyze.seasonNumber ?? null,
  });
}
