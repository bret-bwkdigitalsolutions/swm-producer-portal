import Anthropic from "@anthropic-ai/sdk";

export interface BlogTranslation {
  title: string;
  content: string;
  excerpt: string;
  seoDescription: string;
  seoKeyphrase: string;
}

/**
 * Translate blog post content from one language to another using Claude.
 * Returns the translated fields, or null if translation fails.
 */
export async function translateBlogPost(
  source: {
    title: string;
    content: string;
    excerpt: string | null;
    seoDescription: string | null;
    seoKeyphrase: string | null;
  },
  fromLanguage: string,
  toLanguage: string
): Promise<BlogTranslation | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[translate] ANTHROPIC_API_KEY is not set.");
    return null;
  }

  const fromLabel = fromLanguage === "es" ? "Spanish" : "English";
  const toLabel = toLanguage === "es" ? "Spanish" : "English";

  const prompt = [
    `Translate the following blog post from ${fromLabel} to ${toLabel}.`,
    "Preserve the HTML structure exactly. Do not add or remove HTML tags.",
    "Translate naturally — this should read as if originally written in the target language, not as a literal translation.",
    "",
    "Return the translation in this exact format:",
    "TITLE: <translated title>",
    "EXCERPT: <translated excerpt>",
    "SEO: <translated SEO description, max 160 chars>",
    "KEYPHRASE: <translated focus keyphrase>",
    "",
    "<translated HTML body>",
    "",
    "---",
    "",
    `## Title`,
    source.title,
    "",
    `## Excerpt`,
    source.excerpt ?? "",
    "",
    `## SEO Description`,
    source.seoDescription ?? "",
    "",
    `## Focus Keyphrase`,
    source.seoKeyphrase ?? "",
    "",
    `## HTML Body`,
    source.content,
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const fullText = textBlock?.text ?? "";

    // Parse structured output
    const lines = fullText.split("\n");
    let title = "";
    let excerpt = "";
    let seoDescription = "";
    let seoKeyphrase = "";
    let bodyStartIndex = 0;

    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].trim();
      if (line.startsWith("TITLE:")) {
        title = line.replace("TITLE:", "").trim();
        bodyStartIndex = i + 1;
      } else if (line.startsWith("EXCERPT:")) {
        excerpt = line.replace("EXCERPT:", "").trim();
        bodyStartIndex = i + 1;
      } else if (line.startsWith("SEO:")) {
        seoDescription = line.replace("SEO:", "").trim().slice(0, 160);
        bodyStartIndex = i + 1;
      } else if (line.startsWith("KEYPHRASE:")) {
        seoKeyphrase = line.replace("KEYPHRASE:", "").trim();
        bodyStartIndex = i + 1;
      } else if (line.startsWith("<")) {
        bodyStartIndex = i;
        break;
      }
    }

    const content = lines.slice(bodyStartIndex).join("\n").trim();

    if (!title || !content) {
      console.error("[translate] Translation returned empty title or content.");
      return null;
    }

    return { title, content, excerpt, seoDescription, seoKeyphrase };
  } catch (error) {
    console.error("[translate] Translation failed:", error);
    return null;
  }
}
