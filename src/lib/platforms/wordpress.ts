import { createPost, uploadMedia } from "@/lib/wordpress/client";
import { ContentType } from "@/lib/constants";
import { prepareForWordPress } from "@/lib/image";
import { extractYoutubeVideoId } from "@/lib/youtube-url";

export interface WordPressPublishParams {
  wpShowId: number;
  title: string;
  description: string;
  chapters?: string; // formatted chapter text
  youtubeUrl: string;
  thumbnailGcsPath?: string;
  episodeNumber?: number;
  seasonNumber?: number;
  durationMinutes?: number;
  transcript?: string;
  status: "publish" | "draft" | "future";
  scheduledDate?: string; // ISO date for future posts
  portalUserId: string;
}

export interface WordPressPublishResult {
  postId: number;
  postUrl: string;
}

/**
 * Create a WordPress episode post with YouTube embed.
 */
export async function publishToWordPress(
  params: WordPressPublishParams
): Promise<WordPressPublishResult> {
  const {
    wpShowId,
    title,
    description,
    chapters,
    youtubeUrl,
    thumbnailGcsPath,
    episodeNumber,
    seasonNumber,
    durationMinutes,
    transcript,
    status,
    scheduledDate,
    portalUserId,
  } = params;

  // Build content: description + chapters (if available)
  let content = description.replace(/\n/g, "<br>");
  if (chapters) {
    const formattedChapters = chapters.replace(/\n/g, "<br>");
    content += `<br><br><h3>Chapters</h3>\n${formattedChapters}`;
  }

  // Upload thumbnail as featured image if available (resized to 1200px wide)
  let featuredMediaId: number | undefined;
  if (thumbnailGcsPath) {
    try {
      const processed = await prepareForWordPress(thumbnailGcsPath);
      const filename = `${title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 50)}.jpg`;
      const file = new File([new Uint8Array(processed.buffer)], filename, {
        type: processed.contentType,
      });
      const media = await uploadMedia(file, filename);
      featuredMediaId = media.id;
      console.log(`[wordpress] Uploaded featured image: ${media.id} (${processed.width}×${processed.height})`);
    } catch (error) {
      console.error("[wordpress] Featured image upload failed (non-fatal):", error);
    }
  }

  // Assign brand taxonomy: YDC (show 21) → "Your Dark Companion" (term 2),
  // all other shows → "The Sunset Lounge" (term 3)
  const brandTermId = wpShowId === 21 ? 2 : 3;

  console.log(`[wordpress] Creating episode post: "${title}"`);

  const payload = {
    title,
    content,
    status,
    swm_brand: [brandTermId],
    ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
    ...(status === "future" && scheduledDate ? { date: scheduledDate } : {}),
    meta: {
      _swm_portal_user_id: portalUserId,
      _swm_portal_submission: true,
      parent_show_id: wpShowId,
      youtube_video_url: youtubeUrl,
      youtube_video_id: extractYoutubeVideoId(youtubeUrl) ?? "",
      youtube_thumbnail_url: `https://i.ytimg.com/vi/${extractYoutubeVideoId(youtubeUrl) ?? ""}/hqdefault.jpg`,
      ...(episodeNumber !== undefined
        ? { episode_number: episodeNumber }
        : {}),
      ...(seasonNumber !== undefined
        ? { season_number: seasonNumber }
        : {}),
      ...(durationMinutes !== undefined
        ? { duration_minutes: durationMinutes }
        : {}),
      ...(transcript ? { episode_transcript: transcript } : {}),
    },
  };

  const post = await createPost(ContentType.EPISODE, payload);

  console.log(`[wordpress] Episode post created: ${post.link}`);

  return { postId: post.id, postUrl: post.link };
}
