"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

/** Truncate content to roughly `maxChars`, keeping start and end. */
function truncateMiddle(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const half = Math.floor(maxChars / 2);
  return (
    content.slice(0, half) +
    "\n\n[... middle content trimmed for brevity ...]\n\n" +
    content.slice(-half)
  );
}

const MAX_EDIT_PAIRS = 15;

interface ActionResult {
  success: boolean;
  message: string;
  styleGuide?: string;
}

export async function synthesizeStyleGuide(
  wpShowId: number
): Promise<ActionResult> {
  await requireAdmin();

  const editRecords = await db.blogEditRecord.findMany({
    where: { wpShowId },
    orderBy: { createdAt: "asc" },
  });

  if (editRecords.length === 0) {
    return {
      success: false,
      message: "No edit records found. Publish some edited blog posts first.",
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { success: false, message: "ANTHROPIC_API_KEY is not set." };
  }

  // Build the analysis prompt with all before/after pairs (capped to avoid excessive token usage)
  const records = editRecords.slice(0, MAX_EDIT_PAIRS);
  const pairs = records.map((record, i) => {
    return [
      `## Edit ${i + 1}`,
      "",
      "### Original (AI-generated)",
      truncateMiddle(record.originalContent, 3000),
      "",
      "### Host-Edited Version",
      truncateMiddle(record.editedContent, 3000),
    ].join("\n");
  });

  const prompt = [
    "You are analyzing a series of before/after edits that a podcast host made to AI-generated blog posts.",
    "Your job is to extract a concise style guide that captures this host's voice, preferences, and patterns.",
    "",
    "Below are the original AI-generated versions and the host's edited versions of several blog posts.",
    "",
    ...pairs,
    "",
    "## Instructions",
    "",
    "Analyze the differences between the original and edited versions across ALL examples above.",
    "Write a concise style guide (300-500 words) that captures:",
    "",
    "1. **Tone & Voice** — How does the host's writing differ in tone from the AI? (e.g., more conversational, uses humor, more direct)",
    "2. **Structure** — How does the host reorganize content? (e.g., shorter paragraphs, different heading style, preferred intro/outro patterns)",
    "3. **Vocabulary** — Words or phrases the host consistently adds or prefers, and words they consistently remove or avoid",
    "4. **Content Additions** — Types of content the host adds (personal anecdotes, specific examples, calls to action, questions to the reader)",
    "5. **Things to Avoid** — Patterns the host consistently removes or changes away from",
    "",
    "Write the style guide as direct instructions to an AI writer, e.g., 'Use a conversational tone' not 'The host prefers a conversational tone'.",
    "Focus on patterns that appear across multiple edits, not one-off changes.",
    "Be specific and actionable — 'Use short, punchy sentences' is better than 'Write clearly'.",
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const styleGuide = textBlock?.text?.trim() ?? "";

    if (!styleGuide) {
      return { success: false, message: "AI returned empty style guide." };
    }

    await db.showMetadata.upsert({
      where: { wpShowId },
      create: {
        wpShowId,
        hosts: "",
        styleGuide,
        styleGuideUpdatedAt: new Date(),
      },
      update: {
        styleGuide,
        styleGuideUpdatedAt: new Date(),
      },
    });

    return {
      success: true,
      message: `Style guide synthesized from ${editRecords.length} edited post${editRecords.length !== 1 ? "s" : ""}.`,
      styleGuide,
    };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Style guide synthesis failed";
    return { success: false, message: msg };
  }
}
