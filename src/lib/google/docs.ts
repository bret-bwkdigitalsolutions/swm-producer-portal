import "server-only";

import { getAccessToken } from "./auth";
import type { DocSection, DocRun } from "./types";

// ---------------------------------------------------------------------------
// Google API helpers (fetch-based, no SDK)
// ---------------------------------------------------------------------------

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DOCS_API = "https://docs.googleapis.com/v1";

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

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google API error (${res.status}): ${body}`);
  }

  return res.json();
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

  const re =
    /<(?:strong|b)>(.*?)<\/(?:strong|b)>|<(?:em|i)>(.*?)<\/(?:em|i)>|<a\s+href="([^"]*)">(.*?)<\/a>|([^<]+)/gi;

  while ((match = re.exec(html)) !== null) {
    if (match[1] !== undefined) {
      runs.push({ text: match[1], bold: true });
    } else if (match[2] !== undefined) {
      runs.push({ text: match[2], italic: true });
    } else if (match[3] !== undefined) {
      runs.push({ text: match[4], link: match[3] });
    } else if (match[5] !== undefined) {
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

export async function createGoogleDoc(
  title: string,
  htmlContent: string,
  folderId: string
): Promise<{ docId: string; docUrl: string }> {
  // 1. Create empty doc in the target folder via Drive API
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

  // 2. Apply document-level styling (fonts, spacing, heading styles)
  await googleFetch(`${DOCS_API}/documents/${docId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: buildDocumentStyleRequests() }),
  });

  // 3. Parse HTML into sections and insert formatted content
  const sections = parseHtmlToSections(htmlContent);
  if (sections.length === 0) return { docId, docUrl };

  const requests = buildInsertRequests(sections);

  await googleFetch(`${DOCS_API}/documents/${docId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });

  return { docId, docUrl };
}

// ---------------------------------------------------------------------------
// Google Docs API: Read Doc as HTML
// ---------------------------------------------------------------------------

export async function readGoogleDocAsHtml(docId: string): Promise<{ title: string; html: string }> {
  const doc = await googleFetch(`${DOCS_API}/documents/${docId}`);

  const title: string = doc.title ?? "";
  const sections = docToSections(doc);
  const html = sectionsToHtml(sections);
  return { title, html };
}

// ---------------------------------------------------------------------------
// Internal: Document-level styling (named styles for headings + body text)
// ---------------------------------------------------------------------------

function buildDocumentStyleRequests(): Record<string, unknown>[] {
  return [
    {
      updateDocumentStyle: {
        documentStyle: {
          marginTop: { magnitude: 72, unit: "PT" },
          marginBottom: { magnitude: 72, unit: "PT" },
          marginLeft: { magnitude: 72, unit: "PT" },
          marginRight: { magnitude: 72, unit: "PT" },
        },
        fields: "marginTop,marginBottom,marginLeft,marginRight",
      },
    },
    {
      updateNamedStyle: {
        namedStyleProperties: {
          namedStyleType: "NORMAL_TEXT",
          textStyle: {
            fontSize: { magnitude: 11, unit: "PT" },
            fontFamily: "Georgia",
            foregroundColor: {
              color: { rgbColor: { red: 0.2, green: 0.2, blue: 0.2 } },
            },
          },
          paragraphStyle: {
            lineSpacing: 150,
            spaceBelow: { magnitude: 8, unit: "PT" },
          },
        },
        fields:
          "textStyle.fontSize,textStyle.fontFamily,textStyle.foregroundColor,paragraphStyle.lineSpacing,paragraphStyle.spaceBelow",
      },
    },
    {
      updateNamedStyle: {
        namedStyleProperties: {
          namedStyleType: "HEADING_2",
          textStyle: {
            fontSize: { magnitude: 18, unit: "PT" },
            fontFamily: "Georgia",
            bold: true,
            foregroundColor: {
              color: { rgbColor: { red: 0.1, green: 0.1, blue: 0.1 } },
            },
          },
          paragraphStyle: {
            lineSpacing: 130,
            spaceBefore: { magnitude: 24, unit: "PT" },
            spaceBelow: { magnitude: 8, unit: "PT" },
          },
        },
        fields:
          "textStyle.fontSize,textStyle.fontFamily,textStyle.bold,textStyle.foregroundColor,paragraphStyle.lineSpacing,paragraphStyle.spaceBefore,paragraphStyle.spaceBelow",
      },
    },
    {
      updateNamedStyle: {
        namedStyleProperties: {
          namedStyleType: "HEADING_3",
          textStyle: {
            fontSize: { magnitude: 14, unit: "PT" },
            fontFamily: "Georgia",
            bold: true,
            foregroundColor: {
              color: { rgbColor: { red: 0.15, green: 0.15, blue: 0.15 } },
            },
          },
          paragraphStyle: {
            lineSpacing: 130,
            spaceBefore: { magnitude: 18, unit: "PT" },
            spaceBelow: { magnitude: 6, unit: "PT" },
          },
        },
        fields:
          "textStyle.fontSize,textStyle.fontFamily,textStyle.bold,textStyle.foregroundColor,paragraphStyle.lineSpacing,paragraphStyle.spaceBefore,paragraphStyle.spaceBelow",
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Internal: Build batchUpdate requests from DocSections
// Text inserts must precede style requests. Insert indices assume
// sequential execution within the single batchUpdate call.
// ---------------------------------------------------------------------------

interface BatchRequest {
  insertText?: {
    location: { index: number };
    text: string;
  };
  updateTextStyle?: {
    range: { startIndex: number; endIndex: number };
    textStyle: Record<string, unknown>;
    fields: string;
  };
  updateParagraphStyle?: {
    range: { startIndex: number; endIndex: number };
    paragraphStyle: Record<string, unknown>;
    fields: string;
  };
}

function buildInsertRequests(sections: DocSection[]): BatchRequest[] {
  const textInserts: BatchRequest[] = [];
  const styleRequests: BatchRequest[] = [];

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

    textInserts.push({
      insertText: {
        location: { index: idx },
        text: "\n",
      },
    });
    const sectionEndIdx = idx;
    idx += 1;

    if (section.type === "heading") {
      const namedStyle =
        section.level === 3 ? "HEADING_3" : "HEADING_2";
      styleRequests.push({
        updateParagraphStyle: {
          range: {
            startIndex: sectionStartIdx,
            endIndex: sectionEndIdx + 1,
          },
          paragraphStyle: { namedStyleType: namedStyle },
          fields: "namedStyleType",
        },
      });
    }
  }

  return [...textInserts, ...styleRequests];
}

// ---------------------------------------------------------------------------
// Internal: Convert Google Doc structure to DocSections
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function docToSections(doc: any): DocSection[] {
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
