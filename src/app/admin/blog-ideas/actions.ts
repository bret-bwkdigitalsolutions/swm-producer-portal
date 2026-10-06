"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicModel } from "@/lib/ai/model";

export type { ParsedBlogOutput } from "./parse-blog-output";
import { parseBlogOutput } from "./parse-blog-output";
export { parseBlogOutput };

import { validateCustomBlogInput } from "./validate-custom-blog-input";
export { validateCustomBlogInput };
export type { CustomBlogInput, ValidationResult } from "./validate-custom-blog-input";
import type { CustomBlogInput } from "./validate-custom-blog-input";

// Internal helpers live in a non-"use server" module so they are NOT exposed
// as callable server actions (they have no auth check of their own).
import { createBlogDraftArtifacts, loadStyleContext, runSuggestionBlogAi } from "./blog-helpers";

export interface EpisodeOption {
  id: string;
  title: string;
  createdAt: Date;
}

/**
 * List DistributionJobs for a show that have a non-empty transcript.
 * Returns the 50 most recent.
 */
export async function listEpisodeOptions(
  wpShowId: number
): Promise<EpisodeOption[]> {
  await requireAdmin();

  if (!Number.isInteger(wpShowId) || wpShowId <= 0) return [];

  const jobs = await db.$queryRaw<
    Array<{ id: string; title: string; createdAt: Date }>
  >`
    SELECT "id", "title", "createdAt"
    FROM "distribution_jobs"
    WHERE "wpShowId" = ${wpShowId}
      AND COALESCE(NULLIF("metadata"->>'transcript', ''), '') <> ''
    ORDER BY "createdAt" DESC
    LIMIT 50
  `;

  return jobs;
}

interface GenerateResult {
  success: boolean;
  message: string;
  blogPostId?: string;
  googleDocUrl?: string;
}

/**
 * Generate a blog post from a custom editor brief. Episode is optional —
 * when provided, the job's transcript is injected into the prompt.
 */
export async function generateCustomBlogPost(
  input: CustomBlogInput
): Promise<GenerateResult> {
  await requireAdmin();

  const validation = validateCustomBlogInput(input);
  if (!validation.ok) {
    return { success: false, message: validation.message };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { success: false, message: "ANTHROPIC_API_KEY is not set." };
  }

  // Optional episode lookup
  let jobTitle: string | null = null;
  let jobDescription = "";
  let transcript = "";
  let jobId: string | undefined;

  if (input.jobId) {
    const job = await db.distributionJob.findUnique({
      where: { id: input.jobId },
      select: { id: true, title: true, wpShowId: true, metadata: true },
    });
    if (!job) {
      return { success: false, message: "Selected episode not found." };
    }
    if (job.wpShowId !== input.wpShowId) {
      return {
        success: false,
        message: "Selected episode does not belong to the selected show.",
      };
    }
    const metadata = (job.metadata as Record<string, unknown>) ?? {};
    transcript = (metadata.transcript as string) ?? "";
    jobDescription = (metadata.description as string) ?? "";
    jobTitle = job.title;
    jobId = job.id;
  }

  const showMetadata = await db.showMetadata.findUnique({
    where: { wpShowId: input.wpShowId },
  });
  const showLanguage = showMetadata?.language ?? "en";
  const styleContext = await loadStyleContext(input.wpShowId);

  const episodeBlock = jobTitle
    ? [
        "## Source Episode",
        `Title: "${jobTitle}"`,
        jobDescription ? `Description: ${jobDescription}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const transcriptBlock =
    jobTitle && transcript
      ? `## Episode Transcript (for reference and accuracy — the blog should fit alongside this episode; do NOT summarize it)\n${transcript.slice(0, 8000)}`
      : "";

  const episodeCta = jobTitle
    ? "- Reference the episode at the end with a call-to-action to listen"
    : "";

  const prompt = [
    "You are a skilled blog writer for a podcast network. Write a complete, SEO-optimized blog post based on the editor's brief below.",
    "",
    "## Blog Brief from Editor",
    input.customPrompt.trim(),
    "",
    episodeBlock,
    "",
    transcriptBlock,
    "",
    "## Requirements",
    "- Write 800-1200 words",
    "- Use an engaging, conversational tone",
    "- Include a compelling headline (H1)",
    "- Use H2 and H3 subheadings to break up the content",
    "- Naturally incorporate SEO keywords from the brief",
    episodeCta,
    "- Output the post body in HTML (no <html>/<head>/<body> tags, just the content)",
    "- First line should be the headline as plain text (no HTML)",
    "- Second line should be a ~30 word excerpt/summary for preview cards, prefixed with EXCERPT:",
    "- Third line should be a meta description for SEO (max 160 chars), prefixed with SEO:",
    "- Fourth line should be an SEO focus keyphrase (2-4 words), prefixed with KEYPHRASE:",
    "- Then a blank line, then the HTML body",
    showLanguage === "es"
      ? "- IMPORTANT: Write the entire blog post in Spanish — headline, excerpt, SEO description, keyphrase, and HTML body must all be in Spanish"
      : "",
    styleContext,
    showMetadata?.hosts
      ? `\nIMPORTANT — correct spelling of host name(s): ${showMetadata.hosts}. The transcript may misspell these names. Always use the exact spelling provided here.\n`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  let parsed;
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: getAnthropicModel(),
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    parsed = parseBlogOutput(textBlock?.text ?? "");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "AI generation failed";
    return { success: false, message: msg };
  }

  if (!parsed.title || !parsed.content) {
    return { success: false, message: "AI generated empty content." };
  }

  return createBlogDraftArtifacts({
    wpShowId: input.wpShowId,
    title: parsed.title,
    content: parsed.content,
    excerpt: parsed.excerpt,
    seoDescription: parsed.seoDescription,
    seoKeyphrase: parsed.seoKeyphrase,
    source: "custom",
    jobId,
    customPrompt: input.customPrompt.trim(),
  });
}

/**
 * Generate a full blog post from an AI suggestion and create it as a Google Doc.
 */
export async function generateBlogPost(
  suggestionId: string,
  customInstructions?: string
): Promise<GenerateResult> {
  await requireAdmin();

  const suggestion = await db.aiSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          wpShowId: true,
          metadata: true,
        },
      },
    },
  });

  if (!suggestion) {
    return { success: false, message: "Suggestion not found." };
  }
  if (suggestion.type !== "blog") {
    return { success: false, message: "Not a blog suggestion." };
  }
  if (suggestion.accepted) {
    return { success: false, message: "Blog post already generated." };
  }

  // Atomically claim the suggestion to prevent duplicate generation from race conditions
  const { count } = await db.aiSuggestion.updateMany({
    where: { id: suggestionId, accepted: false },
    data: { accepted: true },
  });
  if (count === 0) {
    return { success: false, message: "Blog post already generated." };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { success: false, message: "ANTHROPIC_API_KEY is not set." };
  }

  let parsed;
  try {
    parsed = await runSuggestionBlogAi({
      apiKey,
      suggestion: {
        content: suggestion.content,
        job: {
          title: suggestion.job.title,
          wpShowId: suggestion.job.wpShowId,
          metadata: suggestion.job.metadata,
        },
      },
      customInstructions,
    });
  } catch (error) {
    // Revert the claim so the suggestion can be retried
    await db.aiSuggestion.update({ where: { id: suggestionId }, data: { accepted: false } });
    const msg = error instanceof Error ? error.message : "AI generation failed";
    return { success: false, message: msg };
  }

  if (!parsed.title || !parsed.content) {
    await db.aiSuggestion.update({ where: { id: suggestionId }, data: { accepted: false } });
    return { success: false, message: "AI generated empty content." };
  }

  return createBlogDraftArtifacts({
    wpShowId: suggestion.job.wpShowId,
    title: parsed.title,
    content: parsed.content,
    excerpt: parsed.excerpt,
    seoDescription: parsed.seoDescription,
    seoKeyphrase: parsed.seoKeyphrase,
    source: "suggestion",
    suggestionId: suggestion.id,
    jobId: suggestion.job.id,
  });
}
