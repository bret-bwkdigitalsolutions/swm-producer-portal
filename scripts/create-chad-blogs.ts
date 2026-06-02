/**
 * One-off script: create 3 custom blog drafts for Chad Stockslager
 * about music & live music from YDC Ep 228 (Majestic Memories).
 *
 * Usage: npx tsx --env-file=.env.local scripts/create-chad-blogs.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import Anthropic from "@anthropic-ai/sdk";

// DATABASE_PUBLIC_URL is reachable from outside Railway's private network.
// Falls back to DATABASE_URL for running inside Railway containers.
const dbUrl = (process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL)!;
const adapter = new PrismaPg({ connectionString: dbUrl });
const db = new PrismaClient({ adapter });

// ---------- Google Auth (inlined from src/lib/google/auth.ts) ----------
async function getAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_DOCS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DOCS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DOCS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing GOOGLE_DOCS_CLIENT_ID / SECRET / REFRESH_TOKEN");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) throw new Error(`Google token error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

// ---------- Google Docs (simplified from src/lib/google/docs.ts) ----------
async function googleFetch(url: string, options: RequestInit = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`Google API error (${res.status}): ${await res.text()}`);
  return res.json();
}

async function createGoogleDoc(
  title: string,
  htmlContent: string,
  folderId: string
): Promise<{ docId: string; docUrl: string }> {
  const DRIVE_API = "https://www.googleapis.com/drive/v3";

  // Create empty doc in folder
  const fileData = await googleFetch(`${DRIVE_API}/files?fields=id,webViewLink`, {
    method: "POST",
    body: JSON.stringify({
      name: title,
      mimeType: "application/vnd.google-apps.document",
      parents: [folderId],
    }),
  });

  const docId: string = fileData.id;
  const docUrl: string = fileData.webViewLink ?? `https://docs.google.com/document/d/${docId}/edit`;

  // Insert the HTML content as plain text (simplified — the portal's full
  // formatter handles headings/bold/italic via batchUpdate, but for drafts
  // that will be reviewed in the portal, the Google Doc just needs the content)
  const DOCS_API = "https://docs.googleapis.com/v1";

  // Strip HTML tags for the Google Doc body (the real content is stored in originalContent)
  const plainText = htmlContent
    .replace(/<h[23][^>]*>/gi, "\n\n### ")
    .replace(/<\/h[23]>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<strong>(.*?)<\/strong>/gi, "$1")
    .replace(/<em>(.*?)<\/em>/gi, "$1")
    .replace(/<a[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (plainText) {
    await googleFetch(`${DOCS_API}/documents/${docId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: plainText,
            },
          },
        ],
      }),
    });
  }

  return { docId, docUrl };
}

// ---------- Blog output parser ----------
function parseBlogOutput(text: string) {
  const lines = text.split("\n");
  let title = "";
  let excerpt = "";
  let seoDescription = "";
  let seoKeyphrase = "";
  let contentStartIdx = 0;

  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i].trim();
    if (
      !title &&
      line &&
      !line.startsWith("EXCERPT:") &&
      !line.startsWith("SEO:") &&
      !line.startsWith("KEYPHRASE:") &&
      !line.startsWith("<")
    ) {
      title = line.replace(/^#+\s*/, "");
      continue;
    }
    if (line.startsWith("EXCERPT:")) {
      excerpt = line.replace("EXCERPT:", "").trim();
      continue;
    }
    if (line.startsWith("SEO:")) {
      seoDescription = line.replace("SEO:", "").trim();
      continue;
    }
    if (line.startsWith("KEYPHRASE:")) {
      seoKeyphrase = line.replace("KEYPHRASE:", "").trim();
      contentStartIdx = i + 1;
      while (contentStartIdx < lines.length && !lines[contentStartIdx].trim()) {
        contentStartIdx++;
      }
      break;
    }
  }

  const content = lines.slice(contentStartIdx).join("\n").trim();
  return { title, excerpt, seoDescription, seoKeyphrase, content };
}

// ---------- Main ----------
const WP_SHOW_ID = 21; // Your Dark Companion

const blogPrompts = [
  `Write a blog post about the evolution of Dallas's live music venue scene, focusing on how historic venues like the Majestic Theatre, the Longhorn Ballroom, and the Granada Theater each create a unique experience for audiences. Draw on the insider perspective of someone who has played in bands across Oak Cliff and Dallas for decades. Explore what makes a great "listening room" different from a standard concert venue — the intimacy, the acoustics, how audiences behave differently in a theater versus a club. Reference specific examples like the Jeff Tweedy squeaky-chair incident at the Majestic, the Donovan solo show, and how the Longhorn Ballroom "transcends being just another place" despite its quirks. The tone should be warm, knowledgeable, and conversational — someone who genuinely loves this city's music history. Author: Chad Stockslager.`,

  `Write a blog post about the lost art of pocket drumming and what legendary drummers like Charlie Watts, John Bonham, and Buddy Rich teach us about simplicity in music. This should be written from the perspective of a drummer who grew up idolizing jazz chops (Buddy Rich, Gene Krupa) but had a transformative moment learning that simplicity and groove matter more than flash. Include the story of playing drums for Bo Diddley — being told "don't do the tom-tom thing" because Bo felt everyone had stolen his signature beat — and how that constraint actually made the performance better. Discuss Charlie Watts's revolutionary grace note on "Jumpin' Jack Flash," Ringo's drumming on "Rain" as a life-changing moment, and how "Give Me Shelter" finally taught the lesson of doing nothing that doesn't need to be there. The tone should be passionate, personal, and steeped in real musical knowledge. Author: Chad Stockslager.`,

  `Write a blog post about how bands actually get booked at major music venues — pulling back the curtain on the promoter-venue-agent pipeline. Explain how a venue like the Majestic Theatre in Dallas works as a "rental house" versus venues that buy talent directly (like the Granada Theater did). Cover the role of publications like Pollstar, how agents reach out to promoters, how gross potential and seat count matter more than chandeliers, and the competitive landscape between venues of similar capacity. Include insights about how artists choose rooms (Elvis Costello picked the Majestic from a video), why some artists don't do sound checks, and the surprising truth that touring "isn't as glamorous as people think." The tone should be insider-knowledgeable without being jargon-heavy, making the business side of live music accessible and fascinating. Author: Chad Stockslager.`,
];

async function main() {
  console.log("Finding job for Majestic episode...");

  const jobs = await db.distributionJob.findMany({
    where: { wpShowId: WP_SHOW_ID },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, title: true, createdAt: true, metadata: true },
  });

  const majesticJob = jobs.find(
    (j) =>
      j.title.toLowerCase().includes("majestic") ||
      j.title.toLowerCase().includes("schwedler")
  );

  if (!majesticJob) {
    console.error("Could not find the Majestic episode job. Available jobs:");
    jobs.forEach((j) => console.log(`  ${j.id} | ${j.title}`));
    process.exit(1);
  }

  console.log(`Found job: ${majesticJob.id} | ${majesticJob.title}`);

  const showFolder = await db.showBlogFolder.findUnique({
    where: { wpShowId: WP_SHOW_ID },
  });

  if (!showFolder) {
    console.error("No Google Drive folder configured for show 21");
    process.exit(1);
  }

  const metadata = (majesticJob.metadata as Record<string, unknown>) ?? {};
  const transcript = (metadata.transcript as string) ?? "";
  const jobDescription = (metadata.description as string) ?? "";

  console.log(`Transcript length: ${transcript.length} chars`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  for (let i = 0; i < blogPrompts.length; i++) {
    const customPrompt = blogPrompts[i];
    console.log(`\n--- Generating blog ${i + 1}/3 ---`);

    const prompt = [
      "You are a skilled blog writer for a podcast network. Write a complete, SEO-optimized blog post based on the editor's brief below.",
      "",
      "## Blog Brief from Editor",
      customPrompt,
      "",
      "## Source Episode",
      `Title: "${majesticJob.title}"`,
      jobDescription ? `Description: ${jobDescription}` : "",
      "",
      transcript
        ? `## Episode Transcript (for reference and accuracy — the blog should fit alongside this episode; do NOT summarize it)\n${transcript.slice(0, 8000)}`
        : "",
      "",
      "## Requirements",
      "- Write 800-1200 words",
      "- Use an engaging, conversational tone",
      "- Include a compelling headline (H1)",
      "- Use H2 and H3 subheadings to break up the content",
      "- Naturally incorporate SEO keywords from the brief",
      "- Reference the episode at the end with a call-to-action to listen",
      "- Output the post body in HTML (no <html>/<head>/<body> tags, just the content)",
      "- First line should be the headline as plain text (no HTML)",
      "- Second line should be a ~30 word excerpt/summary for preview cards, prefixed with EXCERPT:",
      "- Third line should be a meta description for SEO (max 160 chars), prefixed with SEO:",
      "- Fourth line should be an SEO focus keyphrase (2-4 words), prefixed with KEYPHRASE:",
      "- Then a blank line, then the HTML body",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const parsed = parseBlogOutput(textBlock?.text ?? "");

    if (!parsed.title || !parsed.content) {
      console.error(`Blog ${i + 1}: AI generated empty content, skipping`);
      continue;
    }

    console.log(`  Title: ${parsed.title}`);
    console.log(`  Excerpt: ${parsed.excerpt.slice(0, 80)}...`);

    // Create Google Doc
    const { docId, docUrl } = await createGoogleDoc(
      parsed.title,
      parsed.content,
      showFolder.googleFolderId
    );
    console.log(`  Google Doc: ${docUrl}`);

    // Create BlogPost record
    const blogPost = await db.blogPost.create({
      data: {
        jobId: majesticJob.id,
        wpShowId: WP_SHOW_ID,
        source: "custom",
        customPrompt,
        title: parsed.title,
        googleDocId: docId,
        googleDocUrl: docUrl,
        author: "Chad Stockslager",
        excerpt: parsed.excerpt || null,
        seoDescription: parsed.seoDescription || null,
        seoKeyphrase: parsed.seoKeyphrase || null,
        originalContent: parsed.content,
        status: "draft",
      },
    });

    console.log(`  BlogPost ID: ${blogPost.id}`);
  }

  console.log("\nDone — 3 blog drafts created for Chad Stockslager");
  console.log("They should now appear in the portal under Your Dark Companion blog ideas.");
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
