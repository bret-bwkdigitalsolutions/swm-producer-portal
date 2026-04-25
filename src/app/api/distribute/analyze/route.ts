import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { extractAudio } from "@/lib/jobs/audio-extractor";
import { transcribeAudio, formatTranscriptForAI } from "@/lib/transcription";
import { generateAiSuggestions } from "@/lib/jobs/ai-processor";
import { downloadYouTubeVideoToGcs } from "@/lib/jobs/youtube-video-downloader";
import { getRecentEpisodeTitles, getLatestEpisodeNumbers, getShow } from "@/lib/wordpress/client";

/**
 * POST /api/distribute/analyze
 *
 * Triggers the AI analysis pipeline for a distribution job:
 * 1. Extract audio from video
 * 2. Transcribe via Deepgram
 * 3. Generate AI suggestions (summary, chapters, blog ideas)
 *
 * Returns the transcript and suggestions.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, gcsPath: true, title: true, metadata: true, wpShowId: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  if (job.userId !== session.user.id && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    // For live YouTube recordings: download the video to GCS if not already done
    let gcsPath = job.gcsPath;
    if (!gcsPath) {
      const jobMeta = job.metadata as Record<string, unknown>;
      const existingYoutubeUrl = jobMeta.existingYoutubeUrl as string | undefined;
      if (!existingYoutubeUrl) {
        return NextResponse.json({ error: "No video uploaded." }, { status: 400 });
      }
      console.log(`[analyze] Downloading YouTube video for job ${jobId}`);
      gcsPath = await downloadYouTubeVideoToGcs(existingYoutubeUrl, jobId);
      await db.distributionJob.update({
        where: { id: jobId },
        data: { gcsPath },
      });
    }

    // 1. Extract audio
    console.log(`[analyze] Extracting audio for job ${jobId}`);
    const gcsAudioPath = await extractAudio(gcsPath);

    // 2. Transcribe
    console.log(`[analyze] Transcribing audio for job ${jobId}`);
    const transcription = await transcribeAudio(gcsAudioPath);
    const formattedTranscript = formatTranscriptForAI(transcription.segments);

    // Store transcript in job metadata
    const metadata = job.metadata as Record<string, unknown>;
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
    console.log(`[analyze] Generating AI suggestions for job ${jobId}`);
    await generateAiSuggestions(
      jobId,
      formattedTranscript,
      transcription.language,
      undefined,
      recentTitles,
      showName
    );

    // Fetch the generated suggestions
    const suggestions = await db.aiSuggestion.findMany({
      where: { jobId },
      select: { id: true, type: true, content: true, accepted: true },
    });

    return NextResponse.json({
      success: true,
      transcript: transcription.fullText,
      language: transcription.language,
      duration: transcription.duration,
      suggestions,
      episodeNumber: nextEpisodeNumber,
      seasonNumber,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    console.error(`[analyze] Failed for job ${jobId}:`, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
