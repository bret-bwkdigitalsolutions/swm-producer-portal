"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const WP_API_URL = () => process.env.WP_API_URL!;
const WP_AUTH = () =>
  "Basic " +
  Buffer.from(
    `${process.env.WP_APP_USER}:${process.env.WP_APP_PASSWORD}`
  ).toString("base64");

interface GenerateResult {
  success: boolean;
  message: string;
  postUrl?: string;
}

/**
 * Generate a full blog post from an AI suggestion and create it as a WP draft.
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
    "- First line should be the headline as plain text (no HTML), followed by a blank line, then the HTML body",
    customInstructions
      ? `\n## Additional Instructions from Editor\n${customInstructions}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  let postTitle: string;
  let postContent: string;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const fullText = textBlock?.text ?? "";

    // Split first line (title) from the rest (HTML body)
    const lines = fullText.split("\n");
    postTitle = lines[0].replace(/^#+\s*/, "").trim();
    postContent = lines.slice(1).join("\n").trim();

    if (!postTitle || !postContent) {
      return { success: false, message: "AI generated empty content." };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "AI generation failed";
    return { success: false, message: msg };
  }

  // Create WordPress draft post
  try {
    const wpResponse = await fetch(`${WP_API_URL()}/posts`, {
      method: "POST",
      headers: {
        Authorization: WP_AUTH(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: postTitle,
        content: postContent,
        status: "draft",
        meta: {
          _swm_source_episode: suggestion.job.title,
          _swm_source_suggestion_id: suggestion.id,
        },
      }),
    });

    if (!wpResponse.ok) {
      const errorBody = await wpResponse.text();
      return {
        success: false,
        message: `WordPress error (${wpResponse.status}): ${errorBody}`,
      };
    }

    const wpPost = await wpResponse.json();
    const postUrl =
      wpPost.link ?? `${WP_API_URL().replace("/wp-json/wp/v2", "")}/wp-admin/post.php?post=${wpPost.id}&action=edit`;

    // Mark suggestion as accepted/generated
    await db.aiSuggestion.update({
      where: { id: suggestionId },
      data: { accepted: true },
    });

    return {
      success: true,
      message: "Blog post draft created in WordPress.",
      postUrl,
    };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Failed to create WP post";
    return { success: false, message: msg };
  }
}
