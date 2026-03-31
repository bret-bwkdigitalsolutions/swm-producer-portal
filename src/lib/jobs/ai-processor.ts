import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";

export type AiSuggestionType = "chapters" | "summary" | "blog";

interface AnalysisContext {
  title: string;
  description?: string;
  transcript?: string; // timestamped transcript text
  language?: string;
}

let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

function buildChapterPrompt(ctx: AnalysisContext): string {
  if (!ctx.transcript) {
    return [
      "You are helping a podcast producer create chapter markers for an episode.",
      `Episode title: "${ctx.title}"`,
      `Description: ${ctx.description ?? "N/A"}`,
      "",
      "Based on the title and description, suggest a logical chapter structure.",
      "Format each chapter as: HH:MM:SS - Chapter Title",
      "Include a brief one-sentence description for each chapter.",
      "Output ONLY the chapters. No preamble, no introduction, no explanation — just the chapter list.",
    ].join("\n");
  }

  return [
    "You are helping a podcast producer create timestamped chapter markers for an episode.",
    "Analyze the timestamped transcript below and identify natural topic breaks.",
    "Format each chapter as: HH:MM:SS - Chapter Title",
    "Use the actual timestamps from the transcript. Aim for chapters every 5-15 minutes depending on topic changes.",
    "Include a brief one-sentence description for each chapter.",
    "Output ONLY the chapters. No preamble, no introduction, no explanation — just the chapter list.",
    "",
    `Episode title: "${ctx.title}"`,
    "",
    "Transcript:",
    ctx.transcript,
  ].join("\n");
}

function buildSummaryPrompt(ctx: AnalysisContext): string {
  const source = ctx.transcript
    ? `Transcript:\n${ctx.transcript}`
    : `Title: "${ctx.title}"\nDescription: ${ctx.description ?? "N/A"}`;

  return [
    "You are helping a podcast producer write an episode summary for podcast platforms (Apple Podcasts, Spotify, YouTube).",
    "Write a compelling 2-4 sentence summary that:",
    "- Hooks the listener with what they'll learn or experience",
    "- Mentions key topics or guests",
    "- Is optimized for search discoverability",
    "- Uses plain text only, no markdown",
    ctx.language === "es"
      ? "- Write the summary in Spanish since the episode is in Spanish"
      : "",
    "",
    source,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildBlogPrompt(ctx: AnalysisContext): string {
  const source = ctx.transcript
    ? `Transcript:\n${ctx.transcript}`
    : `Title: "${ctx.title}"\nDescription: ${ctx.description ?? "N/A"}`;

  return [
    "You are an SEO content strategist analyzing a podcast episode to find companion blog post opportunities.",
    "",
    "Your goal: identify 2-3 topics that were MENTIONED but NOT deeply explored in the episode.",
    "These topics should be:",
    "- Tangential to the episode content, not a retelling of it",
    "- Interesting enough to stand alone as a blog post",
    "- Likely to attract search engine and AI traffic",
    "- Deep enough to write 800-1200 words about",
    "",
    "For each suggestion, provide:",
    "1. A compelling, SEO-optimized blog post title",
    "2. A 2-3 sentence description of what the post would cover and why it's valuable",
    "3. 5-8 target SEO keywords",
    "4. How it connects to the episode (so we can cross-link)",
    "",
    "DO NOT suggest posts that simply summarize or recap the episode.",
    "DO suggest posts that a listener would want to read AFTER hearing the episode to learn more about something that caught their interest.",
    "",
    source,
  ].join("\n");
}

/**
 * Generate AI suggestions for a distribution job.
 *
 * @param jobId - The distribution job ID
 * @param transcript - Optional timestamped transcript text
 * @param language - Optional detected language code
 * @param types - Which suggestion types to generate (defaults to all)
 */
export async function generateAiSuggestions(
  jobId: string,
  transcript?: string | null,
  language?: string | null,
  types?: AiSuggestionType[]
): Promise<void> {
  const client = getClient();

  if (!client) {
    console.warn(
      "[ai-processor] ANTHROPIC_API_KEY is not set. Skipping AI suggestions."
    );
    return;
  }

  const job = await db.distributionJob.findUnique({ where: { id: jobId } });
  if (!job) {
    console.error(`[ai-processor] Job ${jobId} not found.`);
    return;
  }

  const metadata = job.metadata as Record<string, unknown>;
  const ctx: AnalysisContext = {
    title: job.title,
    description: (metadata.description as string) ?? undefined,
    transcript: transcript ?? undefined,
    language: language ?? undefined,
  };

  const typesToGenerate = types ?? ["chapters", "summary", "blog"];

  const suggestionConfigs: { type: AiSuggestionType; prompt: string }[] = [];

  if (typesToGenerate.includes("chapters")) {
    suggestionConfigs.push({ type: "chapters", prompt: buildChapterPrompt(ctx) });
  }
  if (typesToGenerate.includes("summary")) {
    suggestionConfigs.push({ type: "summary", prompt: buildSummaryPrompt(ctx) });
  }
  if (typesToGenerate.includes("blog")) {
    suggestionConfigs.push({ type: "blog", prompt: buildBlogPrompt(ctx) });
  }

  const results = await Promise.allSettled(
    suggestionConfigs.map(async ({ type, prompt }) => {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const content = textBlock ? textBlock.text : "";

      // Upsert: replace existing suggestion of same type for this job
      await db.aiSuggestion.upsert({
        where: {
          // Use a raw query since there's no compound unique on jobId+type
          // Fall back to create
          id: (
            await db.aiSuggestion.findFirst({
              where: { jobId, type },
              select: { id: true },
            })
          )?.id ?? "nonexistent",
        },
        create: { jobId, type, content, accepted: false },
        update: { content, accepted: false },
      });

      console.log(`[ai-processor] Generated "${type}" for job ${jobId}`);
    })
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[ai-processor] Failed:", result.reason);
    }
  }
}
