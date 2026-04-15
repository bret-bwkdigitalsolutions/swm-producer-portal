"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { createGoogleDoc } from "@/lib/google/docs";

interface GenerateResult {
  success: boolean;
  message: string;
  blogPostId?: string;
  googleDocUrl?: string;
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

  const showMetadata = await db.showMetadata.findUnique({
    where: { wpShowId: suggestion.job.wpShowId },
  });
  const showLanguage = showMetadata?.language ?? "en";

  if (suggestion.type !== "blog") {
    return { success: false, message: "Not a blog suggestion." };
  }

  if (suggestion.accepted) {
    return { success: false, message: "Blog post already generated." };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { success: false, message: "ANTHROPIC_API_KEY is not set." };
  }

  const metadata = suggestion.job.metadata as Record<string, unknown>;
  const transcript = (metadata.transcript as string) ?? "";
  const episodeDescription = (metadata.description as string) ?? "";

  // Generate the full blog post
  const client = new Anthropic({ apiKey });

  const prompt = [
    "You are a skilled blog writer for a podcast network. Write a complete, SEO-optimized blog post based on the topic idea below.",
    "",
    "## Blog Topic Idea",
    suggestion.content,
    "",
    "## Source Episode",
    `Title: "${suggestion.job.title}"`,
    episodeDescription ? `Description: ${episodeDescription}` : "",
    "",
    transcript
      ? `## Episode Transcript (for reference — do NOT summarize the episode, use this for context and accuracy)\n${transcript.slice(0, 8000)}`
      : "",
    "",
    "## Requirements",
    "- Write 800-1200 words",
    "- Use an engaging, conversational tone",
    "- Include a compelling headline (H1)",
    "- Use H2 and H3 subheadings to break up the content",
    "- Naturally incorporate SEO keywords from the topic idea",
    "- Reference the episode at the end with a call-to-action to listen",
    "- Output the post body in HTML (no <html>/<head>/<body> tags, just the content)",
    "- First line should be the headline as plain text (no HTML)",
    "- Second line should be a ~30 word excerpt/summary for preview cards, prefixed with EXCERPT:",
    "- Third line should be a meta description for SEO (max 160 chars), prefixed with SEO:",
    "- Fourth line should be an SEO focus keyphrase (2-4 words), prefixed with KEYPHRASE:",
    "- Then a blank line, then the HTML body",
    showLanguage === "es"
      ? "- IMPORTANT: Write the entire blog post in Spanish — headline, excerpt, SEO description, keyphrase, and HTML body must all be in Spanish"
      : "",
    customInstructions
      ? `\n## Additional Instructions from Editor\n${customInstructions}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  let postTitle: string;
  let postContent: string;
  let excerpt = "";
  let seoDescription = "";
  let seoKeyphrase = "";

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const fullText = textBlock?.text ?? "";

    // Parse structured output: title, excerpt, SEO description, keyphrase, then HTML body
    const lines = fullText.split("\n");
    postTitle = lines[0].replace(/^#+\s*/, "").trim();

    let bodyStartIndex = 1;

    for (let i = 1; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].trim();
      if (line.startsWith("EXCERPT:")) {
        excerpt = line.replace("EXCERPT:", "").trim();
        bodyStartIndex = i + 1;
      } else if (line.startsWith("SEO:")) {
        seoDescription = line.replace("SEO:", "").trim().slice(0, 160);
        bodyStartIndex = i + 1;
      } else if (line.startsWith("KEYPHRASE:")) {
        seoKeyphrase = line.replace("KEYPHRASE:", "").trim();
        bodyStartIndex = i + 1;
      } else if (line.startsWith("<")) {
        // HTML content started
        bodyStartIndex = i;
        break;
      }
    }

    postContent = lines.slice(bodyStartIndex).join("\n").trim();

    if (!postTitle || !postContent) {
      return { success: false, message: "AI generated empty content." };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "AI generation failed";
    return { success: false, message: msg };
  }

  // Look up the show's Google Drive folder
  const showFolder = await db.showBlogFolder.findUnique({
    where: { wpShowId: suggestion.job.wpShowId },
  });

  if (!showFolder) {
    return {
      success: false,
      message: "No Google Drive folder configured for this show. Add a ShowBlogFolder record first.",
    };
  }

  // Look up the most recent author for this show (learned default)
  const previousPost = await db.blogPost.findFirst({
    where: { wpShowId: suggestion.job.wpShowId, status: "published" },
    orderBy: { updatedAt: "desc" },
    select: { author: true },
  });

  // Create Google Doc
  try {
    const { docId, docUrl } = await createGoogleDoc(
      postTitle,
      postContent,
      showFolder.googleFolderId
    );

    // Create BlogPost record
    const blogPost = await db.blogPost.create({
      data: {
        suggestionId: suggestion.id,
        jobId: suggestion.job.id,
        wpShowId: suggestion.job.wpShowId,
        title: postTitle,
        googleDocId: docId,
        googleDocUrl: docUrl,
        author: previousPost?.author ?? null,
        excerpt: excerpt || null,
        seoDescription: seoDescription || null,
        seoKeyphrase: seoKeyphrase || null,
        originalContent: postContent,
        status: "draft",
      },
    });

    // Mark suggestion as accepted
    await db.aiSuggestion.update({
      where: { id: suggestionId },
      data: { accepted: true },
    });

    return {
      success: true,
      message: "Blog draft created in Google Docs.",
      blogPostId: blogPost.id,
      googleDocUrl: docUrl,
    };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Failed to create Google Doc";
    return { success: false, message: msg };
  }
}
