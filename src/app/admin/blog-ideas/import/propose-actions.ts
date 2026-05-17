"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { readGoogleDocAsHtml } from "@/lib/google/docs";
import { parseGoogleDocUrl } from "@/lib/google/doc-url";
import {
  parseFileToHtml,
  UnsupportedFileTypeError,
} from "@/lib/blog/file-import";
import { sanitizeImportedHtml } from "@/lib/blog/sanitize-html";
import {
  buildMetadataPrompt,
  parseMetadataResponse,
  type ProposedMetadata,
  type MetadataLanguage,
} from "@/lib/blog/metadata-prompt";
import Anthropic from "@anthropic-ai/sdk";

export interface ProposeResult {
  success?: boolean;
  message?: string;
  metadata?: ProposedMetadata;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function proposeBlogMetadata(
  _prevState: ProposeResult,
  formData: FormData
): Promise<ProposeResult> {
  await requireAdmin();

  const sourceMode = (formData.get("sourceMode") as string) || "url";
  const rawDocUrl = (formData.get("docUrl") as string)?.trim() ?? "";
  const uploadedFile = formData.get("file") as File | null;
  const rawLanguage = (formData.get("primaryLanguage") as string) || "en";
  const language: MetadataLanguage = rawLanguage === "es" ? "es" : "en";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { success: false, message: "ANTHROPIC_API_KEY is not set." };
  }

  // Resolve content from URL or upload
  let html: string;
  try {
    if (sourceMode === "upload") {
      if (!uploadedFile || uploadedFile.size === 0) {
        return {
          success: false,
          message: "Pick a file to analyze first.",
        };
      }
      if (uploadedFile.size > MAX_UPLOAD_BYTES) {
        return {
          success: false,
          message: `File too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`,
        };
      }
      const buffer = Buffer.from(await uploadedFile.arrayBuffer());
      const parsed = await parseFileToHtml(buffer, uploadedFile.name);
      html = sanitizeImportedHtml(parsed.html);
    } else {
      if (!rawDocUrl) {
        return {
          success: false,
          message: "Paste a Google Doc URL first.",
        };
      }
      const docId = parseGoogleDocUrl(rawDocUrl);
      if (!docId) {
        return {
          success: false,
          message: "Could not extract a Google Doc ID from that URL.",
        };
      }
      const result = await readGoogleDocAsHtml(docId);
      html = sanitizeImportedHtml(result.html);
    }
  } catch (error) {
    if (error instanceof UnsupportedFileTypeError) {
      return {
        success: false,
        message: "Unsupported file type. Use .docx, .md, or .txt.",
      };
    }
    const msg =
      error instanceof Error ? error.message : "Failed to read source.";
    return { success: false, message: `Could not read content: ${msg}` };
  }

  if (!html.trim()) {
    return { success: false, message: "Source is empty." };
  }

  // Ask Claude
  const prompt = buildMetadataPrompt(html, language);

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    const metadata = parseMetadataResponse(textBlock?.text ?? "");
    if (!metadata) {
      return {
        success: false,
        message: "AI returned an unparseable response. Try again.",
      };
    }
    return { success: true, metadata };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Claude call failed.";
    return { success: false, message: msg };
  }
}
