import { createPost, uploadMedia } from "@/lib/wordpress/client";
import { ContentType } from "@/lib/constants";
import { prepareForWordPress } from "@/lib/image";
import { extractYoutubeVideoId } from "@/lib/youtube-url";
import { liveStreamReplacementNote } from "@/lib/live-stream-note";
import {
  renderChaptersForWordPress,
  SWM_CHAPTERS_META_KEY,
} from "@/lib/chapters";
import {
  findLiveStreamCandidate,
  parseAirDate,
  type LiveStreamCandidate,
} from "@/lib/wordpress/live-candidate";

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
  /**
   * Air time of a portal live recording this upload is archiving.
   * Ignored unless `liveRecordingYoutubeId` is also set. Never inferred from
   * the show and the publish date.
   */
  airDate?: string;
  /**
   * YouTube video id from `lookupLiveRecordingAirDate` when that lookup
   * matched a live recording for this show. Supersede meta is sent only when
   * status is "publish" and the website candidate's youtube_id equals this.
   */
  liveRecordingYoutubeId?: string;
  portalUserId: string;
}

export interface WordPressPublishResult {
  postId: number;
  postUrl: string;
  /**
   * WordPress post id of the live-stream episode this post replaces.
   * Set only when the 201 body echoed `_swm_supersedes`. A dropped meta
   * key leaves this null so the UI cannot claim a replacement.
   */
  supersedesLivePostId: number | null;
  /**
   * True when `_swm_supersedes` was sent and the 201 body did not echo it.
   * The website drops invalid supersede meta and still returns 201. The post
   * stands; do not retry.
   */
  supersedeDropped: boolean;
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
    airDate,
    liveRecordingYoutubeId,
    portalUserId,
  } = params;

  // Supersede meta is only for a published archive of a known live recording.
  // A show + date guess (scheduled publish, or "today") must not retire a
  // different episode. Drafts and future posts omit the meta entirely.
  const matchedYoutubeId = liveRecordingYoutubeId?.trim() ?? "";
  const lookupDate = airDate ? parseAirDate(airDate) : null;
  const canSupersede =
    status === "publish" && matchedYoutubeId.length > 0 && lookupDate != null;
  const liveCandidatePromise = canSupersede
    ? findLiveStreamCandidate(wpShowId, lookupDate).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[wordpress] Live-candidate lookup failed (${message}); publishing without supersede.`
        );
        return null;
      })
    : Promise.resolve(null);

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

  const liveCandidate = await liveCandidatePromise;
  const supersede =
    liveCandidate && liveCandidate.youtube_id === matchedYoutubeId
      ? liveCandidate
      : null;
  if (liveCandidate && !supersede) {
    console.warn(
      `[wordpress] Live candidate #${liveCandidate.id} does not match recording ${matchedYoutubeId}; publishing without supersede.`
    );
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
      ...liveCandidateMeta(supersede),
    },
  };

  const post = await createPost(ContentType.EPISODE, payload);
  console.log(`[wordpress] Episode post created: ${post.link}`);
  const echoed =
    supersede != null && responseKeptSupersede(post.meta, supersede.id);
  const supersedeDropped = supersede != null && !echoed;
  if (supersedeDropped && supersede) {
    console.warn(
      `[wordpress] Create response omitted _swm_supersedes for live post #${supersede.id}; not retrying.`
    );
  } else if (echoed && supersede) {
    console.log(`[wordpress] ${liveStreamReplacementNote(supersede.id)}`);
  }
  return {
    postId: post.id,
    postUrl: post.link,
    supersedesLivePostId: echoed && supersede ? supersede.id : null,
    supersedeDropped,
  };
}

/**
 * The website accepts the episode (201) and silently drops supersede meta it
 * does not consider valid. Kept only when the response echoes the id we sent.
 */
function responseKeptSupersede(
  meta: Record<string, unknown> | undefined,
  sentId: number
): boolean {
  if (!meta) return false;
  let raw: unknown = meta._swm_supersedes;
  if (Array.isArray(raw)) raw = raw.length === 1 ? raw[0] : undefined;
  if (typeof raw === "number") return raw === sentId;
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    return Number(raw.trim()) === sentId;
  }
  return false;
}

function liveCandidateMeta(
  candidate: LiveStreamCandidate | null
): Record<string, number | string> {
  if (!candidate) return {};
  const meta: Record<string, number | string> = {
    _swm_supersedes: candidate.id,
  };
  // An empty youtube id is not the recording. Leave the key off rather than
  // sending "" — the caller also refuses to supersede unless the ids match.
  if (candidate.youtube_id) {
    meta._swm_live_youtube_id = candidate.youtube_id;
  }
  return meta;
}
