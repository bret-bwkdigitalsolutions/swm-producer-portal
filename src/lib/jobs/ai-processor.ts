import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";

export type AiSuggestionType = "chapters" | "summary" | "blog" | "keywords" | "title";

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
    "Separate each suggestion with a line containing only '---'.",
    "",
    "DO NOT suggest posts that simply summarize or recap the episode.",
    "DO suggest posts that a listener would want to read AFTER hearing the episode to learn more about something that caught their interest.",
    ctx.language === "es"
      ? "\nIMPORTANT: Write all blog titles, descriptions, and keywords in Spanish. The show is Spanish-language."
      : "",
    "",
    source,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildKeywordsPrompt(ctx: AnalysisContext): string {
  const source = ctx.transcript
    ? `Transcript:\n${ctx.transcript}`
    : `Title: "${ctx.title}"\nDescription: ${ctx.description ?? "N/A"}`;

  return [
    "You are helping a podcast producer tag an episode for SEO discovery.",
    "Generate 8-12 short, SEO-friendly tags (1-3 word phrases each).",
    "Requirements:",
    "- One tag per line",
    "- No markdown, no bullet points, no numbering",
    "- No duplicates",
    "- Lowercase only",
    "- Focus on topics, themes, people, and places discussed",
    ctx.language === "es"
      ? "- Write all tags in Spanish since the episode is in Spanish"
      : "",
    "",
    source,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTitlePrompt(ctx: AnalysisContext, recentTitles: string[], showName?: string): string {
  const source = ctx.transcript
    ? `Transcript:\n${ctx.transcript}`
    : `Description: ${ctx.description ?? "N/A"}`;

  const titleExamples = recentTitles.length > 0
    ? `\nRecent episode titles from this show (match this style and voice):\n${recentTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
    : "";

  return [
    "You are helping a podcast producer title their new episode.",
    showName ? `The show is called "${showName}".` : "",
    "Generate a single episode title that:",
    "- Reflects the main topic or theme discussed in the episode",
    "- Matches the style, voice, and format of this show's previous titles",
    "- Is compelling and would make a listener want to click",
    "- MUST be under 100 characters (YouTube's hard limit)",
    "- Uses plain text only, no quotes or markdown",
    ctx.language === "es"
      ? "- Write the title in Spanish since the episode is in Spanish"
      : "",
    "",
    "Output ONLY the title. No preamble, no explanation, no quotes — just the title text.",
    titleExamples,
    "",
    source,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Generate AI suggestions for a distribution job.
 *
 * @param jobId - The distribution job ID
 * @param transcript - Optional timestamped transcript text
 * @param language - Optional detected language code
 * @param types - Which suggestion types to generate (defaults to all)
 * @param recentTitles - Recent episode titles from the show for style matching
 * @param showName - Name of the show for context
 */
export async function generateAiSuggestions(
  jobId: string,
  transcript?: string | null,
  language?: string | null,
  types?: AiSuggestionType[],
  recentTitles?: string[],
  showName?: string
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

  const showMetadata = await db.showMetadata.findUnique({
    where: { wpShowId: job.wpShowId },
  });

  // ShowMetadata.language takes precedence over detected language for blog content
  const showLanguage = showMetadata?.language ?? language ?? undefined;

  const metadata = job.metadata as Record<string, unknown>;
  const ctx: AnalysisContext = {
    title: job.title,
    description: (metadata.description as string) ?? undefined,
    transcript: transcript ?? undefined,
    language: showLanguage,
  };

  const typesToGenerate = types ?? ["chapters", "summary", "blog", "keywords", "title"];

  const suggestionConfigs: { type: AiSuggestionType; prompt: string }[] = [];

  if (typesToGenerate.includes("chapters")) {
    suggestionConfigs.push({ type: "chapters", prompt: buildChapterPrompt(ctx) });
  }
  if (typesToGenerate.includes("summary")) {
    suggestionConfigs.push({ type: "summary", prompt: buildSummaryPrompt(ctx) });
  }
  if (typesToGenerate.includes("keywords")) {
    suggestionConfigs.push({ type: "keywords", prompt: buildKeywordsPrompt(ctx) });
  }
  if (typesToGenerate.includes("title")) {
    suggestionConfigs.push({
      type: "title",
      prompt: buildTitlePrompt(ctx, recentTitles ?? [], showName),
    });
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

  // Generate blog ideas as separate records (one per idea)
  // Skip if blog ideas already exist for this job to avoid overwriting
  // ideas a user has already seen or accepted
  if (typesToGenerate.includes("blog")) {
    const existingBlogs = await db.aiSuggestion.count({
      where: { jobId, type: "blog" },
    });

    if (existingBlogs > 0) {
      console.log(
        `[ai-processor] Skipping blog ideas for job ${jobId} — ${existingBlogs} already exist`
      );
    } else {
      try {
        const response = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          messages: [{ role: "user", content: buildBlogPrompt(ctx) }],
        });

        const textBlock = response.content.find((b) => b.type === "text");
        const fullContent = textBlock?.text ?? "";

        // Split into individual ideas by '---' separator
        const ideas = fullContent
          .split(/\n---\n/)
          .map((s) => s.trim())
          .filter(Boolean);

        for (const idea of ideas) {
          await db.aiSuggestion.create({
            data: { jobId, type: "blog", content: idea, accepted: false },
          });
        }

        console.log(
          `[ai-processor] Generated ${ideas.length} blog ideas for job ${jobId}`
        );
      } catch (error) {
        console.error("[ai-processor] Blog ideas failed:", error);
      }
    }
  }
}
