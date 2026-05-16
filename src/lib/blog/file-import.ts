import "server-only";

import mammoth from "mammoth";
import { marked } from "marked";

export interface ParsedFile {
  html: string;
  // Some formats (.docx) carry a title separately from the body. Plain text and
  // markdown imports return null — the caller falls back to filename or
  // user-provided title override.
  title: string | null;
}

export class UnsupportedFileTypeError extends Error {
  constructor(public filename: string) {
    super(`Unsupported file type: ${filename}`);
    this.name = "UnsupportedFileTypeError";
  }
}

/**
 * Parse an uploaded file buffer into clean HTML suitable for WordPress import.
 *
 * Supported formats:
 *   - .docx  → mammoth (preserves headings, lists, bold, italic, links)
 *   - .md    → marked (CommonMark)
 *   - .txt   → paragraph-wrap each non-empty block
 *
 * Word-imported HTML is messy out of the box (ms-office namespaces, inline
 * styles); the caller should pipe this output through sanitizeImportedHtml
 * before persisting. Text content is never modified.
 */
export async function parseFileToHtml(
  buffer: Buffer,
  filename: string
): Promise<ParsedFile> {
  const ext = getExtension(filename);

  switch (ext) {
    case "docx":
      return parseDocx(buffer);
    case "md":
    case "markdown":
      return parseMarkdown(buffer);
    case "txt":
      return parseText(buffer);
    default:
      throw new UnsupportedFileTypeError(filename);
  }
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

async function parseDocx(buffer: Buffer): Promise<ParsedFile> {
  const result = await mammoth.convertToHtml({ buffer });
  return {
    html: result.value,
    title: null, // mammoth does not surface the doc title separately
  };
}

async function parseMarkdown(buffer: Buffer): Promise<ParsedFile> {
  const text = buffer.toString("utf-8");
  const html = await marked.parse(text, { async: true });
  return { html, title: null };
}

function parseText(buffer: Buffer): ParsedFile {
  const text = buffer.toString("utf-8");
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const html = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
  return { html, title: null };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
