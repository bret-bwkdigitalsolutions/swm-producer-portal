import "server-only";

import { db } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const MAX_EDIT_PAIRS = 15;
const FIRST_SYNTHESIS_AT_EDITS = 5;
const REFRESH_AFTER_NEW_EDITS = 3;

function truncateMiddle(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const half = Math.floor(maxChars / 2);
  return (
    content.slice(0, half) +
    "\n\n[... middle content trimmed for brevity ...]\n\n" +
    content.slice(-half)
  );
}

export interface SynthesisDecision {
  shouldSynthesize: boolean;
  reason:
    | "first_synthesis"
    | "refresh_threshold_met"
    | "below_first_threshold"
    | "not_enough_new_edits";
  totalEdits: number;
  newEditsSinceLastSynthesis: number;
}

/**
 * Pure decision function: should we (re)synthesize the style guide for this
 * show, given the current edit-record state?
 *
 * Triggers:
 *   - No guide yet AND total edits >= FIRST_SYNTHESIS_AT_EDITS
 *   - Has guide AND new edits since last synthesis >= REFRESH_AFTER_NEW_EDITS
 */
export function decideSynthesis(args: {
  hasExistingGuide: boolean;
  totalEdits: number;
  newEditsSinceLastSynthesis: number;
}): SynthesisDecision {
  const { hasExistingGuide, totalEdits, newEditsSinceLastSynthesis } = args;

  if (!hasExistingGuide) {
    if (totalEdits >= FIRST_SYNTHESIS_AT_EDITS) {
      return {
        shouldSynthesize: true,
        reason: "first_synthesis",
        totalEdits,
        newEditsSinceLastSynthesis,
      };
    }
    return {
      shouldSynthesize: false,
      reason: "below_first_threshold",
      totalEdits,
      newEditsSinceLastSynthesis,
    };
  }

  if (newEditsSinceLastSynthesis >= REFRESH_AFTER_NEW_EDITS) {
    return {
      shouldSynthesize: true,
      reason: "refresh_threshold_met",
      totalEdits,
      newEditsSinceLastSynthesis,
    };
  }
  return {
    shouldSynthesize: false,
    reason: "not_enough_new_edits",
    totalEdits,
    newEditsSinceLastSynthesis,
  };
}

export interface SynthesisResult {
  success: boolean;
  message: string;
  styleGuide?: string;
}

/**
 * Run synthesis for a show — no auth check. Caller (server action or auto
 * trigger) is responsible for authorization. Picks the MOST RECENT
 * MAX_EDIT_PAIRS edits because the host's voice may have drifted as they
 * found their groove; early edits over-weight an exploratory phase.
 */
export async function synthesizeForShow(
  wpShowId: number
): Promise<SynthesisResult> {
  const editRecords = await db.blogEditRecord.findMany({
    where: { wpShowId },
    orderBy: { createdAt: "desc" },
    take: MAX_EDIT_PAIRS,
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

  // Render oldest-first for natural narrative in the prompt
  const records = [...editRecords].reverse();
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

/**
 * Auto-trigger: called from the publish flow after a new BlogEditRecord is
 * captured. Decides whether to run synthesis based on edit counts. Errors
 * are logged but never thrown — this must never block publishing.
 */
export async function maybeAutoSynthesize(wpShowId: number): Promise<void> {
  try {
    const [showMetadata, totalEdits] = await Promise.all([
      db.showMetadata.findUnique({
        where: { wpShowId },
        select: { styleGuide: true, styleGuideUpdatedAt: true },
      }),
      db.blogEditRecord.count({ where: { wpShowId } }),
    ]);

    const hasExistingGuide = !!showMetadata?.styleGuide;
    const styleGuideUpdatedAt = showMetadata?.styleGuideUpdatedAt;

    const newEditsSinceLastSynthesis = styleGuideUpdatedAt
      ? await db.blogEditRecord.count({
          where: {
            wpShowId,
            createdAt: { gt: styleGuideUpdatedAt },
          },
        })
      : totalEdits;

    const decision = decideSynthesis({
      hasExistingGuide,
      totalEdits,
      newEditsSinceLastSynthesis,
    });

    if (!decision.shouldSynthesize) {
      console.log(
        `[style-guide] Auto-sync skipped for show ${wpShowId}: ${decision.reason} (total=${totalEdits}, new=${newEditsSinceLastSynthesis})`
      );
      return;
    }

    console.log(
      `[style-guide] Auto-syncing for show ${wpShowId}: ${decision.reason} (total=${totalEdits}, new=${newEditsSinceLastSynthesis})`
    );

    const result = await synthesizeForShow(wpShowId);
    if (result.success) {
      console.log(
        `[style-guide] Auto-sync complete for show ${wpShowId}: ${result.message}`
      );
    } else {
      console.error(
        `[style-guide] Auto-sync failed for show ${wpShowId}: ${result.message}`
      );
    }
  } catch (error) {
    console.error(
      `[style-guide] Auto-sync crashed for show ${wpShowId}:`,
      error
    );
  }
}
