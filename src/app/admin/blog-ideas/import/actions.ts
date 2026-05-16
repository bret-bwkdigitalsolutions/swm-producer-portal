"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { readGoogleDocAsHtml } from "@/lib/google/docs";
import { parseGoogleDocUrl } from "@/lib/google/doc-url";
import {
  parseFileToHtml,
  UnsupportedFileTypeError,
} from "@/lib/blog/file-import";
import { sanitizeImportedHtml } from "@/lib/blog/sanitize-html";
import { publishToWordPress } from "@/app/admin/blog-ideas/blog-actions";
import { translateBlogPost } from "@/lib/ai/translate";
import { revalidateTag } from "next/cache";

interface FormState {
  success?: boolean;
  message?: string;
  wpPostUrl?: string;
  blogPostId?: string;
}

const SUPPORTED_LANGUAGES = ["en", "es"] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export async function importBlogFromGoogleDoc(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  await requireAdmin();

  const sourceMode = (formData.get("sourceMode") as string) || "url";
  const rawDocUrl = (formData.get("docUrl") as string)?.trim() ?? "";
  const uploadedFile = formData.get("file") as File | null;
  const wpShowIdRaw = formData.get("wpShowId") as string;
  const author = (formData.get("author") as string)?.trim() ?? "";
  const titleOverride =
    (formData.get("title") as string)?.trim() ?? "";
  const excerpt = (formData.get("excerpt") as string)?.trim() ?? "";
  const seoDescription =
    (formData.get("seoDescription") as string)?.trim() ?? "";
  const seoKeyphrase =
    (formData.get("seoKeyphrase") as string)?.trim() ?? "";
  const primaryLanguageRaw = (formData.get("primaryLanguage") as string) || "";
  const publishLive = formData.get("publishLive") === "on";

  const wpShowId = parseInt(wpShowIdRaw, 10);
  if (isNaN(wpShowId) || wpShowId < 1) {
    return { success: false, message: "Pick a valid show." };
  }

  if (!author) {
    return { success: false, message: "Author is required." };
  }
  if (!excerpt) {
    return { success: false, message: "Excerpt is required." };
  }
  if (!seoDescription) {
    return { success: false, message: "SEO description is required." };
  }
  if (!seoKeyphrase) {
    return { success: false, message: "Focus keyphrase is required." };
  }
  if (seoDescription.length > 160) {
    return {
      success: false,
      message: `SEO description must be ≤160 chars (currently ${seoDescription.length}).`,
    };
  }

  let primaryLanguage: SupportedLanguage | null = null;
  if (primaryLanguageRaw) {
    if (
      !(SUPPORTED_LANGUAGES as readonly string[]).includes(primaryLanguageRaw)
    ) {
      return { success: false, message: "Unsupported primary language." };
    }
    primaryLanguage = primaryLanguageRaw as SupportedLanguage;
  }

  // Resolve content from URL or uploaded file
  let docHtml: string;
  let docTitle: string | null = null;
  let googleDocId = "";
  let googleDocUrl = "";

  if (sourceMode === "upload") {
    if (!uploadedFile || uploadedFile.size === 0) {
      return { success: false, message: "Pick a file to upload." };
    }
    if (uploadedFile.size > MAX_UPLOAD_BYTES) {
      return {
        success: false,
        message: `File too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`,
      };
    }
    try {
      const buffer = Buffer.from(await uploadedFile.arrayBuffer());
      const parsed = await parseFileToHtml(buffer, uploadedFile.name);
      docHtml = sanitizeImportedHtml(parsed.html);
      docTitle = parsed.title;
    } catch (error) {
      if (error instanceof UnsupportedFileTypeError) {
        return {
          success: false,
          message: `Unsupported file type. Use .docx, .md, or .txt.`,
        };
      }
      const msg =
        error instanceof Error ? error.message : "File parse failed.";
      return { success: false, message: `Could not parse file: ${msg}` };
    }
  } else {
    // Default: Google Doc URL
    if (!rawDocUrl) {
      return { success: false, message: "Google Doc URL is required." };
    }
    const docId = parseGoogleDocUrl(rawDocUrl);
    if (!docId) {
      return {
        success: false,
        message: "Could not extract a Google Doc ID from that URL.",
      };
    }
    googleDocId = docId;
    googleDocUrl = `https://docs.google.com/document/d/${docId}/edit`;

    try {
      const result = await readGoogleDocAsHtml(docId);
      docTitle = result.title;
      docHtml = sanitizeImportedHtml(result.html);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to read Google Doc.";
      return {
        success: false,
        message: `Could not read Google Doc — make sure it is shared with the portal service account. (${msg})`,
      };
    }
  }

  const title = titleOverride || docTitle || extractFilenameTitle(uploadedFile);
  if (!title) {
    return {
      success: false,
      message: "No title found. Provide a Title override.",
    };
  }

  if (!docHtml.trim()) {
    return { success: false, message: "Imported content is empty." };
  }

  // Persist BlogPost. The originalContent field is used by the existing
  // publish pipeline as the "AI baseline to diff against"; for imports
  // there is no AI baseline, so we leave it null. We stash the resolved
  // HTML in editedContent so publishToWordPress can fall back to it when
  // the googleDocId path isn't available (uploaded files).
  const blogPost = await db.blogPost.create({
    data: {
      wpShowId,
      source: "import",
      title,
      googleDocId,
      googleDocUrl,
      author,
      excerpt,
      seoDescription,
      seoKeyphrase,
      primaryLanguage,
      status: "draft",
    },
  });

  // The existing publishToWordPress reads from Google Doc if googleDocId is
  // set. For uploaded files there's no Doc, so we monkey-patch by writing
  // the HTML into a transient store keyed by the BlogPost ID. Simpler path:
  // call the WP API directly when no Doc was used, mirroring the existing
  // publishToWordPress logic but skipping the Doc read.
  if (sourceMode === "upload") {
    const result = await publishUploadedBlog({
      blogPostId: blogPost.id,
      title,
      docHtml,
      wpStatus: publishLive ? "publish" : "draft",
    });
    revalidateTag("blog-posts", "max");
    return result;
  }

  // Google Doc path — reuse the canonical publishToWordPress so all the
  // bilingual / metadata / featured-image logic stays in one place.
  const publishResult = await publishToWordPress(
    blogPost.id,
    publishLive ? "publish" : "draft"
  );

  revalidateTag("blog-posts", "max");

  if (!publishResult.success) {
    return {
      success: false,
      message: `Blog post created in portal (id ${blogPost.id}) but WordPress push failed: ${publishResult.message}`,
      blogPostId: blogPost.id,
    };
  }

  return {
    success: true,
    message: publishLive
      ? "Published to WordPress."
      : "Drafted in WordPress. Review and publish from WP admin.",
    wpPostUrl: publishResult.wpPostUrl,
    blogPostId: blogPost.id,
  };
}

function extractFilenameTitle(file: File | null): string {
  if (!file) return "";
  const name = file.name;
  const dot = name.lastIndexOf(".");
  return (dot === -1 ? name : name.slice(0, dot)).replace(/[-_]+/g, " ");
}

interface PublishUploadedBlogInput {
  blogPostId: string;
  title: string;
  docHtml: string;
  wpStatus: "publish" | "draft";
}

/**
 * Publish a file-uploaded blog. Mirrors the Google-Doc publish path in
 * blog-actions.ts but skips the Doc read step (the content already lives
 * in docHtml). Kept inline rather than duplicated in blog-actions.ts so
 * the Doc-based publishToWordPress stays the canonical reference.
 */
async function publishUploadedBlog(
  input: PublishUploadedBlogInput
): Promise<FormState> {
  const { blogPostId, title, docHtml, wpStatus } = input;

  const blogPost = await db.blogPost.findUnique({
    where: { id: blogPostId },
  });
  if (!blogPost) return { success: false, message: "Blog post not found." };

  const showMetadata = await db.showMetadata.findUnique({
    where: { wpShowId: blogPost.wpShowId },
  });
  const primaryLanguage =
    blogPost.primaryLanguage ?? showMetadata?.language ?? "en";

  // Uploaded imports always translate (mirrors the source==="import" rule)
  let translationMeta: Record<string, string> = {};
  const secondaryLanguage = primaryLanguage === "es" ? "en" : "es";
  const translation = await translateBlogPost(
    {
      title,
      content: docHtml,
      excerpt: blogPost.excerpt,
      seoDescription: blogPost.seoDescription,
      seoKeyphrase: blogPost.seoKeyphrase,
    },
    primaryLanguage,
    secondaryLanguage
  );
  if (translation) {
    const suffix = `_${secondaryLanguage}`;
    translationMeta = {
      [`_swm_blog_title${suffix}`]: translation.title,
      [`_swm_blog_content${suffix}`]: translation.content,
      [`_swm_blog_excerpt${suffix}`]: translation.excerpt,
      [`_swm_blog_seo_description${suffix}`]: translation.seoDescription,
      [`_swm_blog_seo_keyphrase${suffix}`]: translation.seoKeyphrase,
    };
  } else {
    console.warn(
      `[importBlog] Translation failed for ${blogPostId}; publishing primary language only.`
    );
  }

  const wpApiUrl = process.env.WP_API_URL;
  const wpUser = process.env.WP_APP_USER;
  const wpPassword = process.env.WP_APP_PASSWORD;
  if (!wpApiUrl || !wpUser || !wpPassword) {
    return {
      success: false,
      message: "WordPress credentials are not configured on the server.",
    };
  }
  const auth =
    "Basic " + Buffer.from(`${wpUser}:${wpPassword}`).toString("base64");

  const wpResponse = await fetch(`${wpApiUrl}/swm_blog`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      content: docHtml,
      status: wpStatus,
      excerpt: blogPost.excerpt ?? "",
      meta: {
        parent_show_id: blogPost.wpShowId,
        _swm_blog_author: blogPost.author ?? "",
        _swm_blog_primary_language: primaryLanguage,
        _swm_portal_submission: true,
        ...(blogPost.seoDescription
          ? { _swm_seo_description: blogPost.seoDescription }
          : {}),
        ...(blogPost.seoKeyphrase
          ? { _swm_seo_focus_keyphrase: blogPost.seoKeyphrase }
          : {}),
        ...translationMeta,
      },
    }),
  });

  if (!wpResponse.ok) {
    const body = await wpResponse.text();
    return {
      success: false,
      message: `WordPress error (${wpResponse.status}): ${body}`,
      blogPostId,
    };
  }

  const wpPost = (await wpResponse.json()) as { id: number; link?: string };
  const adminBase = wpApiUrl.replace("/wp-json/wp/v2", "");
  const wpPostUrl =
    wpPost.link ?? `${adminBase}/wp-admin/post.php?post=${wpPost.id}&action=edit`;

  await db.blogPost.update({
    where: { id: blogPostId },
    data: {
      status: "published",
      wpPostId: wpPost.id,
      wpPostUrl,
    },
  });

  return {
    success: true,
    message:
      wpStatus === "publish"
        ? "Published to WordPress."
        : "Drafted in WordPress. Review and publish from WP admin.",
    wpPostUrl,
    blogPostId,
  };
}
