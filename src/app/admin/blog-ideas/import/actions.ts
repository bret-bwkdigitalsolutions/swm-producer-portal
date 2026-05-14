"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { readGoogleDocAsHtml } from "@/lib/google/docs";
import { parseGoogleDocUrl } from "@/lib/google/doc-url";
import { publishToWordPress } from "@/app/admin/blog-ideas/blog-actions";
import { revalidateTag } from "next/cache";

interface FormState {
  success?: boolean;
  message?: string;
  wpPostUrl?: string;
  blogPostId?: string;
}

export async function importBlogFromGoogleDoc(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  await requireAdmin();

  const rawDocUrl = (formData.get("docUrl") as string)?.trim() ?? "";
  const wpShowIdRaw = formData.get("wpShowId") as string;
  const author = (formData.get("author") as string)?.trim() ?? "";
  const titleOverride =
    (formData.get("title") as string)?.trim() ?? "";
  const excerpt = (formData.get("excerpt") as string)?.trim() ?? "";
  const seoDescription =
    (formData.get("seoDescription") as string)?.trim() ?? "";
  const seoKeyphrase =
    (formData.get("seoKeyphrase") as string)?.trim() ?? "";
  const publishLive = formData.get("publishLive") === "on";

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

  // Read the doc to validate access + grab the title fallback
  let docTitle: string;
  try {
    const result = await readGoogleDocAsHtml(docId);
    docTitle = result.title;
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Failed to read Google Doc.";
    return {
      success: false,
      message: `Could not read Google Doc — make sure it is shared with the portal service account. (${msg})`,
    };
  }

  const title = titleOverride || docTitle;
  if (!title) {
    return {
      success: false,
      message: "Doc has no title and no title override was provided.",
    };
  }

  // Standard Doc URL shape — keep canonical so admins can click through
  const googleDocUrl = `https://docs.google.com/document/d/${docId}/edit`;

  const blogPost = await db.blogPost.create({
    data: {
      wpShowId,
      source: "import",
      title,
      googleDocId: docId,
      googleDocUrl,
      author,
      excerpt,
      seoDescription,
      seoKeyphrase,
      // originalContent intentionally null — there's no AI baseline for
      // host-authored imports, so the edit-record diff path is skipped.
      status: "draft",
    },
  });

  // Hand off to the existing publish pipeline. This handles bilingual
  // translation, WP custom-post-type assignment, taxonomy, and writes
  // back wpPostId / wpPostUrl on the BlogPost row.
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
