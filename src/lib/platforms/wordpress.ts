import { createPost } from "@/lib/wordpress/client";
import { ContentType } from "@/lib/constants";

export interface WordPressPublishParams {
  wpShowId: number;
  title: string;
  description: string;
  chapters?: string; // formatted chapter text
  youtubeUrl: string;
  episodeNumber?: number;
  seasonNumber?: number;
  durationMinutes?: number;
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
    episodeNumber,
    seasonNumber,
    durationMinutes,
    status,
    scheduledDate,
    portalUserId,
  } = params;

  // Build content: description + chapters (if available)
  let content = description;
  if (chapters) {
    content += `\n\n<h3>Chapters</h3>\n<pre>${chapters}</pre>`;
  }

  console.log(`[wordpress] Creating episode post: "${title}"`);

  const payload = {
    title,
    content,
    status,
    ...(status === "future" && scheduledDate ? { date: scheduledDate } : {}),
    meta: {
      _swm_portal_user_id: portalUserId,
      _swm_portal_submission: true,
      parent_show_id: wpShowId,
      youtube_video_url: youtubeUrl,
      ...(episodeNumber !== undefined
        ? { episode_number: episodeNumber }
        : {}),
      ...(seasonNumber !== undefined
        ? { season_number: seasonNumber }
        : {}),
      ...(durationMinutes !== undefined
        ? { duration_minutes: durationMinutes }
        : {}),
    },
  };

  const post = await createPost(ContentType.EPISODE, payload);

  console.log(`[wordpress] Episode post created: ${post.link}`);

  return { postId: post.id, postUrl: post.link };
}
