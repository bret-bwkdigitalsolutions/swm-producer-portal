import { prepareForWordPress } from "@/lib/image";
import { renderChaptersForWordPress } from "@/lib/chapters";
import { uploadMedia, wpAuthorizationHeader } from "@/lib/wordpress/client";
import { callPortalWordPress, shouldProxyWordPress } from "@/lib/wordpress/portal-proxy";
import { WpApiError, WordPressBlockedError } from "@/lib/wordpress/types";

/**
 * Create or update the members-only OG post. This is not an swm_episode and
 * it does not require a YouTube URL. The website route dedups on show id +
 * Vimeo video id, so a retry updates the same post.
 */

export interface PublishOgEpisodeParams {
  wpShowId: number;
  title: string;
  description: string;
  chapters?: string;
  audioDurationSeconds?: number;
  transcript?: string;
  transcriptVtt?: string;
  vimeoVideoId: string;
  mediaUrl: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  thumbnailGcsPath?: string;
  portalUserId: string;
  portalJobId: string;
  status: "publish" | "draft";
}

export interface PublishOgEpisodeResult {
  postId: number;
  postUrl: string;
  created: boolean;
}

interface OgContentResponse {
  id: number;
  url?: string;
  link?: string;
  created?: boolean;
}

export async function publishOgEpisode(
  params: PublishOgEpisodeParams
): Promise<PublishOgEpisodeResult> {
  if (shouldProxyWordPress()) {
    return callPortalWordPress<PublishOgEpisodeResult>({
      op: "publishOg",
      params,
    });
  }
  return publishOgEpisodeDirect(params);
}

export async function publishOgEpisodeDirect(
  params: PublishOgEpisodeParams
): Promise<PublishOgEpisodeResult> {
  const videoId = params.vimeoVideoId.trim();
  if (!/^\d+$/.test(videoId)) {
    throw new Error("Vimeo video id is missing, so the OG post was not created.");
  }
  if (!/^https:\/\/vimeo\.com\/\d+(?:\/[A-Za-z0-9]+)?\/?$/.test(params.mediaUrl.split("?")[0])) {
    throw new Error("Vimeo media URL is not a vimeo.com video link.");
  }

  let content = params.description.replace(/\n/g, "<br>");
  const renderedChapters = renderChaptersForWordPress(
    params.chapters,
    params.audioDurationSeconds
  );
  if (renderedChapters) {
    content += `<br><br>${renderedChapters.html}`;
  }

  let featuredMediaId: number | undefined;
  if (params.thumbnailGcsPath) {
    try {
      const processed = await prepareForWordPress(params.thumbnailGcsPath);
      const filename = `${params.title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 50)}.jpg`;
      const file = new File([new Uint8Array(processed.buffer)], filename, {
        type: processed.contentType,
      });
      const media = await uploadMedia(file, filename);
      featuredMediaId = media.id;
    } catch (error) {
      console.error("[wordpress] OG featured image upload failed (non-fatal):", error);
    }
  }

  const payload = {
    title: params.title,
    content,
    status: params.status,
    show_id: params.wpShowId,
    section: "og",
    vimeo_video_id: videoId,
    media_url: params.mediaUrl.split("?")[0],
    ...(params.thumbnailUrl ? { thumbnail_url: params.thumbnailUrl } : {}),
    ...(params.durationSeconds ? { duration_seconds: params.durationSeconds } : {}),
    ...(renderedChapters?.structuredJson
      ? { chapters: renderedChapters.structuredJson }
      : {}),
    ...(params.transcript ? { transcript: params.transcript } : {}),
    ...(params.transcriptVtt ? { transcript_vtt: params.transcriptVtt } : {}),
    ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
    portal_user_id: params.portalUserId,
    portal_job_id: params.portalJobId,
  };

  const response = await postOgContent(payload);
  const postUrl = response.url || response.link;
  if (!response.id || !postUrl) {
    throw new Error("WordPress did not return the OG post id.");
  }
  return {
    postId: response.id,
    postUrl,
    created: response.created !== false,
  };
}

export function ogContentEndpoint(): string {
  const wpApiUrl = process.env.WP_API_URL?.trim();
  if (!wpApiUrl) {
    throw new Error("WP_API_URL is not configured.");
  }
  const base = wpApiUrl.replace(/\/wp\/v2\/?$/, "");
  return `${base}/swm-premium/v1/og-content`;
}

async function postOgContent(payload: Record<string, unknown>): Promise<OgContentResponse> {
  const endpoint = ogContentEndpoint();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: wpAuthorizationHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WpApiError(`WP API network error: ${reason}`, 0, "/swm-premium/v1/og-content");
  }

  const body = await response.text().catch(() => "");
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (/html/i.test(contentType) || body.replace(/^\uFEFF/, "").trimStart().startsWith("<")) {
    throw new WordPressBlockedError(response.status, body, "/swm-premium/v1/og-content");
  }
  if (!response.ok) {
    throw new WpApiError(
      `WP API error: ${response.status} — ${body.slice(0, 500)}`,
      response.status,
      "/swm-premium/v1/og-content"
    );
  }
  return JSON.parse(body) as OgContentResponse;
}
