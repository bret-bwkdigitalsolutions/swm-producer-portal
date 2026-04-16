"use server";

import { requireAdmin } from "@/lib/auth-guard";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
import { db } from "@/lib/db";
import { readGoogleDocAsHtml } from "@/lib/google/docs";
import { translateBlogPost } from "@/lib/ai/translate";
import { revalidateTag } from "next/cache";
import { uploadMedia } from "@/lib/wordpress/client";
import { prepareForWordPress } from "@/lib/image";

const WP_API_URL = () => process.env.WP_API_URL!;
const WP_AUTH = () =>
  "Basic " +
  Buffer.from(
    `${process.env.WP_APP_USER}:${process.env.WP_APP_PASSWORD}`
  ).toString("base64");

interface ActionResult {
  success: boolean;
  message: string;
  wpPostUrl?: string;
}

/**
 * Update the author field on a BlogPost.
 */
export async function updateBlogPostAuthor(
  blogPostId: string,
  author: string
): Promise<ActionResult> {
  await requireAdmin();

  await db.blogPost.update({
    where: { id: blogPostId },
    data: { author: author.trim() || null },
  });

  return { success: true, message: "Author updated." };
}

/**
 * Send the Google Doc link to the host via email.
 */
export async function sendToHost(
  blogPostId: string,
  hostEmails: string
): Promise<ActionResult> {
  await requireAdmin();

  const blogPost = await db.blogPost.findUnique({
    where: { id: blogPostId },
    include: {
      job: { select: { title: true } },
    },
  });

  if (!blogPost) {
    return { success: false, message: "Blog post not found." };
  }

  const emails = hostEmails
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (emails.length === 0) {
    return { success: false, message: "At least one email is required." };
  }

  // Get show name for the email
  const { getCachedShows } = await import("@/lib/wordpress/cache");
  const shows = await getCachedShows().catch(() => []);
  const showName =
    shows.find((s) => s.id === blogPost.wpShowId)?.title.rendered ??
    "your show";

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { success: false, message: "RESEND_API_KEY is not set." };
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  const subject = `Blog draft ready for review: ${blogPost.title}`;
  const episodeRow = blogPost.job
    ? `<tr>
        <td style="padding: 8px 0; color: #666;">Episode</td>
        <td style="padding: 8px 0; color: #111;">${escapeHtml(blogPost.job.title)}</td>
      </tr>`
    : "";

  const introSentence = blogPost.job
    ? `A blog draft has been created based on your recent episode of <strong>${escapeHtml(showName)}</strong>.`
    : `A blog draft has been created for <strong>${escapeHtml(showName)}</strong>.`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 16px; font-size: 20px; color: #111;">
        Blog Draft Ready for Review
      </h2>
      <p style="color: #333; line-height: 1.6;">
        ${introSentence}
        Please review and edit directly in the Google Doc.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px 0; color: #666; width: 100px;">Title</td>
          <td style="padding: 8px 0; color: #111; font-weight: 600;">${escapeHtml(blogPost.title)}</td>
        </tr>
        ${episodeRow}
        <tr>
          <td style="padding: 8px 0; color: #666;">Show</td>
          <td style="padding: 8px 0; color: #111;">${escapeHtml(showName)}</td>
        </tr>
      </table>
      <a href="${blogPost.googleDocUrl}" style="display: inline-block; background: #111; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
        Open Google Doc
      </a>
      <p style="margin-top: 32px; font-size: 12px; color: #999;">
        — Stolen Water Media
      </p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: "SWM Producer Portal <info@stolenwatermedia.com>",
      to: emails,
      subject,
      html,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to send email";
    return { success: false, message: msg };
  }

  const emailsString = emails.join(", ");

  await db.blogPost.update({
    where: { id: blogPostId },
    data: {
      status: "reviewing",
      hostEmail: emailsString,
    },
  });

  // Remember these emails for future blog reviews for this show
  await db.showMetadata.upsert({
    where: { wpShowId: blogPost.wpShowId },
    update: { blogReviewerEmails: emailsString },
    create: {
      wpShowId: blogPost.wpShowId,
      hosts: "",
      blogReviewerEmails: emailsString,
    },
  });

  return { success: true, message: `Email sent to ${emailsString}.` };
}

/**
 * Read the Google Doc content and publish it to WordPress.
 */
export async function publishToWordPress(
  blogPostId: string,
  wpStatus: "publish" | "draft" = "publish"
): Promise<ActionResult> {
  await requireAdmin();

  if (wpStatus !== "publish" && wpStatus !== "draft") {
    return { success: false, message: "Invalid publish status." };
  }

  const blogPost = await db.blogPost.findUnique({
    where: { id: blogPostId },
    include: {
      job: {
        select: {
          title: true,
          wpShowId: true,
          metadata: true,
          platforms: {
            where: { platform: "website", status: "completed" },
            select: { externalId: true },
            take: 1,
          },
        },
      },
      suggestion: { select: { id: true } },
    },
  });

  if (!blogPost) {
    return { success: false, message: "Blog post not found." };
  }

  if (blogPost.status === "published") {
    return { success: false, message: "Already published." };
  }

  // Read current content from Google Doc
  let docTitle: string;
  let docHtml: string;
  try {
    const result = await readGoogleDocAsHtml(blogPost.googleDocId);
    docTitle = result.title;
    docHtml = result.html;
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Failed to read Google Doc";
    return { success: false, message: msg };
  }

  if (!docHtml.trim()) {
    return { success: false, message: "Google Doc is empty." };
  }

  // Capture edit record if host made changes
  if (blogPost.originalContent && blogPost.originalContent !== docHtml) {
    try {
      await db.blogEditRecord.upsert({
        where: { blogPostId: blogPost.id },
        create: {
          blogPostId: blogPost.id,
          wpShowId: blogPost.wpShowId,
          originalContent: blogPost.originalContent,
          editedContent: docHtml,
        },
        update: {
          originalContent: blogPost.originalContent,
          editedContent: docHtml,
        },
      });
    } catch (error) {
      // Non-fatal — don't block publishing if edit capture fails
      console.error("[blog] Edit record capture failed (non-fatal):", error);
    }
  }

  // Use the BlogPost title (admin may have edited it), fall back to doc title
  const title = blogPost.title || docTitle;

  // Look up show language settings
  const showMetadata = await db.showMetadata.findUnique({
    where: { wpShowId: blogPost.wpShowId },
  });
  const isBilingual = showMetadata?.bilingual ?? false;
  const primaryLanguage = showMetadata?.language ?? "en";

  // Translate if bilingual
  let translationMeta: Record<string, string> = {};
  if (isBilingual) {
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
        `[publishToWordPress] Translation failed for blog post ${blogPostId}. Publishing primary language only.`
      );
    }
  }

  // Upload the episode's thumbnail as the blog's featured image,
  // falling back to the show's featured image if no episode thumbnail exists
  let featuredMediaId: number | undefined;
  const metadata = blogPost.job?.metadata as Record<string, unknown> | null | undefined;
  const thumbnailGcsPath = metadata?.thumbnailGcsPath as string | undefined;
  if (thumbnailGcsPath) {
    try {
      const processed = await prepareForWordPress(thumbnailGcsPath);
      const filename = `${title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 50)}.jpg`;
      const file = new File([new Uint8Array(processed.buffer)], filename, {
        type: processed.contentType,
      });
      const media = await uploadMedia(file, filename);
      featuredMediaId = media.id;
      console.log(`[blog] Uploaded featured image from episode: ${media.id} (${processed.width}×${processed.height})`);
    } catch (error) {
      console.error("[blog] Featured image upload failed (non-fatal):", error);
    }
  }

  // Fallback: use the show's featured image from WordPress
  if (!featuredMediaId) {
    try {
      const showRes = await fetch(
        `${WP_API_URL()}/swm_show/${blogPost.wpShowId}?_fields=featured_media`,
        { headers: { Authorization: WP_AUTH() } }
      );
      if (showRes.ok) {
        const show = await showRes.json();
        if (show.featured_media) {
          featuredMediaId = show.featured_media;
          console.log(`[blog] Using show featured image: ${featuredMediaId}`);
        }
      }
    } catch (error) {
      console.error("[blog] Show featured image lookup failed (non-fatal):", error);
    }
  }

  // Publish to WordPress as swm_blog custom post type
  try {
    const wpResponse = await fetch(`${WP_API_URL()}/swm_blog`, {
      method: "POST",
      headers: {
        Authorization: WP_AUTH(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        content: docHtml,
        status: wpStatus,
        excerpt: blogPost.excerpt ?? "",
        ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
        meta: {
          parent_show_id: blogPost.wpShowId,
          _swm_blog_author: blogPost.author ?? "",
          ...(blogPost.suggestion
            ? { _swm_source_suggestion_id: blogPost.suggestion.id }
            : {}),
          ...(blogPost.job?.platforms[0]?.externalId
            ? { _swm_linked_episode: parseInt(blogPost.job.platforms[0].externalId, 10) }
            : {}),
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
      const errorBody = await wpResponse.text();
      return {
        success: false,
        message: `WordPress error (${wpResponse.status}): ${errorBody}`,
      };
    }

    const wpPost = await wpResponse.json();
    const wpPostUrl =
      wpPost.link ??
      `${WP_API_URL().replace("/wp-json/wp/v2", "")}/wp-admin/post.php?post=${wpPost.id}&action=edit`;

    await db.blogPost.update({
      where: { id: blogPostId },
      data: {
        status: "published",
        wpPostId: wpPost.id,
        wpPostUrl: wpPostUrl,
      },
    });

    revalidateTag("blog-posts", "max");

    return { success: true, message: "Published to WordPress.", wpPostUrl };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Failed to publish to WordPress";
    return { success: false, message: msg };
  }
}
