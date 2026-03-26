import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AiSuggestionType = "chapters" | "summary" | "blog";

interface JobContext {
  title: string;
  description?: string;
  transcript?: string;
}

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null;
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildChapterPrompt(ctx: JobContext): string {
  const source = ctx.transcript
    ? `Transcript:\n${ctx.transcript}`
    : `Title: ${ctx.title}\nDescription: ${ctx.description ?? "N/A"}`;

  return [
    "You are helping a podcast producer create timestamped chapter markers for an episode.",
    "Analyze the content below and suggest chapter breakdowns with timestamps.",
    "Format each chapter as: HH:MM:SS - Chapter Title",
    "Include a brief one-sentence description for each chapter.",
    "If you are working from a title/description only (no transcript), provide your best guess at a logical chapter structure.",
    "",
    source,
  ].join("\n");
}

function buildSummaryPrompt(ctx: JobContext): string {
  const source = ctx.transcript
    ? `Transcript:\n${ctx.transcript}`
    : `Title: ${ctx.title}\nDescription: ${ctx.description ?? "N/A"}`;

  return [
    "You are helping a podcast producer write a concise episode summary suitable for podcast platforms (Apple Podcasts, Spotify, etc.).",
    "The summary should be 2-4 sentences, engaging, and optimized for discoverability.",
    "Do not use markdown formatting. Write plain text only.",
    "",
    source,
  ].join("\n");
}

function buildBlogPrompt(ctx: JobContext): string {
  const source = ctx.transcript
    ? `Transcript:\n${ctx.transcript}`
    : `Title: ${ctx.title}\nDescription: ${ctx.description ?? "N/A"}`;

  return [
    "You are helping a podcast producer brainstorm companion blog content ideas based on an episode.",
    "Suggest 2-3 blog post ideas that could complement this episode. For each suggestion provide:",
    "1. A compelling blog post title",
    "2. A 2-3 sentence description of what the post would cover",
    "3. Key SEO keywords to target",
    "",
    source,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Generate AI suggestions for a distribution job and persist them as
 * AiSuggestion records.
 *
 * If the Anthropic API key is not configured the function logs a warning and
 * returns without creating any suggestions.
 */
export async function generateAiSuggestions(
  jobId: string,
  transcript?: string | null
): Promise<void> {
  const client = getClient();

  if (!client) {
    console.warn(
      "[ai-processor] ANTHROPIC_API_KEY is not set. Skipping AI suggestion generation."
    );
    return;
  }

  // Fetch job context from the database
  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    console.error(`[ai-processor] Job ${jobId} not found.`);
    return;
  }

  const metadata = job.metadata as Record<string, unknown>;

  const ctx: JobContext = {
    title: job.title,
    description: (metadata.description as string) ?? undefined,
    transcript: transcript ?? undefined,
  };

  // Generate all three suggestion types in parallel
  const suggestionConfigs: {
    type: AiSuggestionType;
    prompt: string;
  }[] = [
    { type: "chapters", prompt: buildChapterPrompt(ctx) },
    { type: "summary", prompt: buildSummaryPrompt(ctx) },
    { type: "blog", prompt: buildBlogPrompt(ctx) },
  ];

  const results = await Promise.allSettled(
    suggestionConfigs.map(async ({ type, prompt }) => {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      // Extract text from the response
      const textBlock = response.content.find(
        (block) => block.type === "text"
      );
      const content = textBlock ? textBlock.text : "";

      await db.aiSuggestion.create({
        data: {
          jobId,
          type,
          content,
          accepted: false,
        },
      });

      console.log(
        `[ai-processor] Generated "${type}" suggestion for job ${jobId}`
      );
    })
  );

  // Log any failures but do not throw — partial results are acceptable
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(
        `[ai-processor] Failed to generate suggestion:`,
        result.reason
      );
    }
  }
}
