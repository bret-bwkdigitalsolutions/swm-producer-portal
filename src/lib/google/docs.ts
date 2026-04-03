import "server-only";

import { docs as docsApi } from "@googleapis/docs";
import { drive as driveApi } from "@googleapis/drive";
import type { docs_v1 } from "@googleapis/docs";
import { getGoogleAuth } from "./auth";
import type { DocSection, DocRun } from "./types";

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

function getDocsClient() {
  const auth = getGoogleAuth();
  return docsApi({ version: "v1", auth });
}

function getDriveClient() {
  const auth = getGoogleAuth();
  return driveApi({ version: "v3", auth });
}

// ---------------------------------------------------------------------------
// Pure conversion: HTML -> DocSection[]
// ---------------------------------------------------------------------------

export function parseHtmlToSections(html: string): DocSection[] {
  if (!html) return [];

  const BLOCK_RE = /<(h2|h3|p)(?:\s[^>]*)?>([\s\S]+?)<\/\1>/gi;
  const sections: DocSection[] = [];
  let match: RegExpExecArray | null;

  while ((match = BLOCK_RE.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const inner = match[2];

    const runs = parseInlineRuns(inner);

    if (tag === "h2" || tag === "h3") {
      sections.push({
        type: "heading",
        level: tag === "h2" ? 2 : 3,
        runs,
      });
    } else {
      sections.push({ type: "paragraph", runs });
    }
  }

  return sections;
}

function parseInlineRuns(html: string): DocRun[] {
  const runs: DocRun[] = [];
  let match: RegExpExecArray | null;

  // Create a new regex each time to avoid lastIndex issues
  const re =
    /<(?:strong|b)>(.*?)<\/(?:strong|b)>|<(?:em|i)>(.*?)<\/(?:em|i)>|<a\s+href="([^"]*)">(.*?)<\/a>|([^<]+)/gi;

  while ((match = re.exec(html)) !== null) {
    if (match[1] !== undefined) {
      // bold
      runs.push({ text: match[1], bold: true });
    } else if (match[2] !== undefined) {
      // italic
      runs.push({ text: match[2], italic: true });
    } else if (match[3] !== undefined) {
      // link
      runs.push({ text: match[4], link: match[3] });
    } else if (match[5] !== undefined) {
      // plain text
      runs.push({ text: match[5] });
    }
  }

  return runs;
}

// ---------------------------------------------------------------------------
// Pure conversion: DocSection[] -> HTML
// ---------------------------------------------------------------------------

export function sectionsToHtml(sections: DocSection[]): string {
  return sections
    .map((section) => {
      const inner = section.runs.map(runToHtml).join("");

      if (section.type === "heading") {
        const tag = `h${section.level ?? 2}`;
        return `<${tag}>${inner}</${tag}>`;
      }
      return `<p>${inner}</p>`;
    })
    .join("\n");
}

function runToHtml(run: DocRun): string {
  const hasFormatting = run.link || run.bold || run.italic;

  // Pull leading/trailing whitespace outside formatting tags
  let leading = "";
  let text = run.text;

  if (hasFormatting) {
    const match = text.match(/^(\s*)([\s\S]*)$/);
    if (match) {
      leading = match[1];
      text = match[2];
    }
  }

  if (run.link) {
    text = `<a href="${run.link}">${text}</a>`;
  }
  if (run.bold) {
    text = `<strong>${text}</strong>`;
  }
  if (run.italic) {
    text = `<em>${text}</em>`;
  }

  return leading + text;
}

// ---------------------------------------------------------------------------
// Google Docs API: Create Doc
// ---------------------------------------------------------------------------

/**
 * Creates a Google Doc in the specified Drive folder with formatted content.
 * Returns the new document ID and URL.
 */
export async function createGoogleDoc(
  title: string,
  htmlContent: string,
  folderId: string
): Promise<{ docId: string; docUrl: string }> {
  const drive = getDriveClient();

  // 1. Create an empty doc in the target folder
  const fileRes = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: "application/vnd.google-apps.document",
      parents: [folderId],
    },
    fields: "id,webViewLink",
  });

  const docId = fileRes.data.id;
  if (!docId) throw new Error("Failed to create Google Doc — no ID returned");

  const docUrl = fileRes.data.webViewLink ?? `https://docs.google.com/document/d/${docId}/edit`;

  // 2. Parse HTML into sections, then build batch update requests
  const sections = parseHtmlToSections(htmlContent);
  if (sections.length === 0) return { docId, docUrl };

  const requests = buildInsertRequests(sections);

  const docsClient = getDocsClient();
  await docsClient.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });

  return { docId, docUrl };
}

// ---------------------------------------------------------------------------
// Google Docs API: Read Doc as HTML
// ---------------------------------------------------------------------------

/**
 * Reads a Google Doc and returns its title and content as HTML.
 */
export async function readGoogleDocAsHtml(docId: string): Promise<{ title: string; html: string }> {
  const docsClient = getDocsClient();
  const res = await docsClient.documents.get({ documentId: docId });
  const doc = res.data;

  const title = doc.title ?? "";
  const sections = docToSections(doc);
  const html = sectionsToHtml(sections);
  return { title, html };
}

// ---------------------------------------------------------------------------
// Internal: Build batchUpdate requests from DocSections
// ---------------------------------------------------------------------------

function buildInsertRequests(
  sections: DocSection[]
): docs_v1.Schema$Request[] {
  const textInserts: docs_v1.Schema$Request[] = [];
  const styleRequests: docs_v1.Schema$Request[] = [];

  // We insert text starting at index 1 (after the implicit newline).
  // Each section's text is followed by a newline. We track the running index.
  let idx = 1;

  for (const section of sections) {
    const sectionStartIdx = idx;

    for (const run of section.runs) {
      const runStart = idx;
      const runEnd = idx + run.text.length;

      textInserts.push({
        insertText: {
          location: { index: idx },
          text: run.text,
        },
      });
      idx += run.text.length;

      // Style this run
      if (run.bold) {
        styleRequests.push({
          updateTextStyle: {
            range: { startIndex: runStart, endIndex: runEnd },
            textStyle: { bold: true },
            fields: "bold",
          },
        });
      }
      if (run.italic) {
        styleRequests.push({
          updateTextStyle: {
            range: { startIndex: runStart, endIndex: runEnd },
            textStyle: { italic: true },
            fields: "italic",
          },
        });
      }
      if (run.link) {
        styleRequests.push({
          updateTextStyle: {
            range: { startIndex: runStart, endIndex: runEnd },
            textStyle: { link: { url: run.link } },
            fields: "link",
          },
        });
      }
    }

    // Insert newline after section
    textInserts.push({
      insertText: {
        location: { index: idx },
        text: "\n",
      },
    });
    const sectionEndIdx = idx; // end before the newline for paragraph style
    idx += 1;

    // Apply heading style
    if (section.type === "heading") {
      const namedStyle =
        section.level === 3 ? "HEADING_3" : "HEADING_2";
      styleRequests.push({
        updateParagraphStyle: {
          range: {
            startIndex: sectionStartIdx,
            endIndex: sectionEndIdx + 1, // include newline in paragraph range
          },
          paragraphStyle: { namedStyleType: namedStyle },
          fields: "namedStyleType",
        },
      });
    }
  }

  // Text inserts first, then style updates
  return [...textInserts, ...styleRequests];
}

// ---------------------------------------------------------------------------
// Internal: Convert Google Doc structure to DocSections
// ---------------------------------------------------------------------------

function docToSections(doc: docs_v1.Schema$Document): DocSection[] {
  const content = doc.body?.content;
  if (!content) return [];

  const sections: DocSection[] = [];

  for (const element of content) {
    const paragraph = element.paragraph;
    if (!paragraph) continue;

    const namedStyle = paragraph.paragraphStyle?.namedStyleType;
    const runs: DocRun[] = [];

    for (const elem of paragraph.elements ?? []) {
      const textRun = elem.textRun;
      if (!textRun?.content) continue;

      // Strip trailing newline
      const text = textRun.content.replace(/\n$/, "");
      if (!text) continue;

      const run: DocRun = { text };
      const style = textRun.textStyle;

      if (style?.bold) run.bold = true;
      if (style?.italic) run.italic = true;
      if (style?.link?.url) run.link = style.link.url;

      runs.push(run);
    }

    if (runs.length === 0) continue;

    if (namedStyle === "HEADING_2") {
      sections.push({ type: "heading", level: 2, runs });
    } else if (namedStyle === "HEADING_3") {
      sections.push({ type: "heading", level: 3, runs });
    } else {
      sections.push({ type: "paragraph", runs });
    }
  }

  return sections;
}
