import { createPost, uploadMedia } from "@/lib/wordpress/client";
import { ContentType } from "@/lib/constants";
import { prepareForWordPress } from "@/lib/image";
import { extractYoutubeVideoId } from "@/lib/youtube-url";
import {
  renderChaptersForWordPress,
  SWM_CHAPTERS_META_KEY,
} from "@/lib/chapters";

export interface WordPressPublishParams {
  wpShowId: number;
  title: string;
  description: string;
  chapters?: string; // formatted chapter text (HH:MM:SS - Title)
  /**
   * Audio duration in seconds. Used as the last chapter's `end` when the
   * chapter text parses. Omit when unknown.
   */
  audioDurationSeconds?: number;
  youtubeUrl: string;
  thumbnailGcsPath?: string;
  episodeNumber?: number;
  seasonNumber?: number;
  durationMinutes?: number;
  transcript?: string;
  /** Timestamped WebVTT — powers the website's "Mark That" bookmark scanner. */
  transcriptVtt?: string;
  isPremiumOnly?: boolean;
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
    audioDurationSeconds,
    youtubeUrl,
    thumbnailGcsPath,
    episodeNumber,
    seasonNumber,
    durationMinutes,
    transcript,
    transcriptVtt,
    isPremiumOnly,
    status,
    scheduledDate,
    portalUserId,
  } = params;

  // Build content: description + chapters (if available).
  // Parseable chapters become H2s with id anchors and ?t= seek links, and
  // the same structure is sent as `_swm_chapters` for the website theme.
  // Unparseable text keeps the previous <h3> + <br> block. See
  // docs/transcript-quality.md for the meta contract.
  let content = description.replace(/\n/g, "<br>");
  const renderedChapters = renderChaptersForWordPress(
    chapters,
    audioDurationSeconds
  );
  if (renderedChapters) {
    content += `<br><br>${renderedChapters.html}`;
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

  const videoId = extractYoutubeVideoId(youtubeUrl) ?? "";
  if (!videoId) {
    console.warn(`[wordpress] Could not extract video ID from YouTube URL: ${youtubeUrl}`);
  }

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
      youtube_video_id: videoId,
      youtube_thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      ...(episodeNumber !== undefined
        ? { episode_number: episodeNumber }
        : {}),
      ...(seasonNumber !== undefined
        ? { season_number: seasonNumber }
        : {}),
      ...(durationMinutes !== undefined
        ? { duration_minutes: durationMinutes }
        : {}),
      ...(renderedChapters?.structuredJson
        ? { [SWM_CHAPTERS_META_KEY]: renderedChapters.structuredJson }
        : {}),
      ...(transcript ? { episode_transcript: transcript } : {}),
      // Timestamped WebVTT — the website auto-scans this for "Mark That"
      // bookmarks the moment it arrives. Only send when non-empty.
      ...(transcriptVtt ? { _swm_transcript_vtt: transcriptVtt } : {}),
      ...(isPremiumOnly ? { is_premium_only: true } : {}),
    },
  };

  const post = await createPost(ContentType.EPISODE, payload);

  console.log(`[wordpress] Episode post created: ${post.link}`);

  return { postId: post.id, postUrl: post.link };
}
