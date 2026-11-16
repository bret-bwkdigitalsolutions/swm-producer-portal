import "server-only";
import {
  createPost,
  findEpisodeByTitleOrSlug,
  getLatestEpisodeNumbers,
  getRecentEpisodeTitles,
  getShow,
  updatePost,
  uploadMedia,
} from "@/lib/wordpress/client";
import {
  publishOgEpisode,
  type PublishOgEpisodeParams,
} from "@/lib/platforms/wordpress-og";
import { lookupLiveStreamCandidate } from "@/lib/wordpress/live-candidate";
import { websiteVerificationIssuesFromWordPress } from "@/lib/jobs/verify-distribution";
import type { WpCreatePostPayload } from "@/lib/wordpress/types";

/**
 * A bad worker request. Distinct from a WordPress failure so the route can
 * answer 400 instead of 502.
 */
export class PortalWordPressRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PortalWordPressRequestError";
    this.status = status;
  }
}

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function positiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function ogPublishParams(value: unknown): PublishOgEpisodeParams | null {
  const record = asRecord(value);
  if (!record) return null;
  const wpShowId = positiveInt(record.wpShowId);
  const title = requiredString(record.title);
  const description = typeof record.description === "string" ? record.description : null;
  const vimeoVideoId = requiredString(record.vimeoVideoId);
  const mediaUrl = requiredString(record.mediaUrl);
  const portalUserId = requiredString(record.portalUserId);
  const portalJobId = requiredString(record.portalJobId);
  const status = record.status === "draft" ? "draft" : record.status === "publish" ? "publish" : null;
  if (
    wpShowId == null ||
    !title ||
    description == null ||
    !vimeoVideoId ||
    !mediaUrl ||
    !portalUserId ||
    !portalJobId ||
    !status
  ) {
    return null;
  }
  return {
    wpShowId,
    title,
    description,
    chapters: typeof record.chapters === "string" ? record.chapters : undefined,
    audioDurationSeconds:
      typeof record.audioDurationSeconds === "number" ? record.audioDurationSeconds : undefined,
    transcript: typeof record.transcript === "string" ? record.transcript : undefined,
    transcriptVtt: typeof record.transcriptVtt === "string" ? record.transcriptVtt : undefined,
    vimeoVideoId,
    mediaUrl,
    thumbnailUrl: typeof record.thumbnailUrl === "string" ? record.thumbnailUrl : undefined,
    durationSeconds: typeof record.durationSeconds === "number" ? record.durationSeconds : undefined,
    thumbnailGcsPath:
      typeof record.thumbnailGcsPath === "string" ? record.thumbnailGcsPath : undefined,
    portalUserId,
    portalJobId,
    status,
  };
}

function requiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Run one worker WordPress operation on the portal. Callers must wrap this
 * in `runOnPortal` so the functions below talk to WordPress instead of
 * calling this endpoint again.
 */
export async function dispatchPortalWordPress(body: unknown): Promise<unknown> {
  const record = asRecord(body);
  const op = record ? requiredString(record.op) : null;
  if (!record || !op) {
    throw new PortalWordPressRequestError("Missing operation");
  }

  switch (op) {
    case "getShow": {
      const id = positiveInt(record.id);
      if (id == null) throw new PortalWordPressRequestError("getShow requires a positive id");
      return getShow(id);
    }
    case "liveCandidate": {
      const wpShowId = positiveInt(record.wpShowId);
      const airDate = requiredString(record.airDate);
      if (wpShowId == null || !airDate) {
        throw new PortalWordPressRequestError("liveCandidate requires wpShowId and airDate");
      }
      const youtubeId = typeof record.youtubeId === "string" ? record.youtubeId : undefined;
      return lookupLiveStreamCandidate(wpShowId, airDate, youtubeId);
    }
    case "createPost": {
      const contentType = requiredString(record.contentType);
      const payload = asRecord(record.payload);
      if (!contentType || !payload) {
        throw new PortalWordPressRequestError("createPost requires contentType and payload");
      }
      return createPost(contentType, payload as WpCreatePostPayload);
    }
    case "updatePost": {
      const contentType = requiredString(record.contentType);
      const postId = positiveInt(record.postId);
      const payload = asRecord(record.payload);
      if (!contentType || postId == null || !payload) {
        throw new PortalWordPressRequestError("updatePost requires contentType, postId, and payload");
      }
      return updatePost(contentType, postId, payload as Partial<WpCreatePostPayload>);
    }
    case "findEpisode": {
      const title = requiredString(record.title);
      const wpShowId = positiveInt(record.wpShowId);
      if (!title || wpShowId == null) {
        throw new PortalWordPressRequestError("findEpisode requires title and wpShowId");
      }
      return findEpisodeByTitleOrSlug(title, wpShowId, {
        jobStartedAt: typeof record.jobStartedAt === "string" ? record.jobStartedAt : null,
        youtubeVideoId: typeof record.youtubeVideoId === "string" ? record.youtubeVideoId : null,
        youtubeVideoUrl: typeof record.youtubeVideoUrl === "string" ? record.youtubeVideoUrl : null,
      });
    }
    case "recentEpisodeTitles": {
      const wpShowId = positiveInt(record.wpShowId);
      if (wpShowId == null) {
        throw new PortalWordPressRequestError("recentEpisodeTitles requires wpShowId");
      }
      const count = positiveInt(record.count) ?? undefined;
      return getRecentEpisodeTitles(wpShowId, count);
    }
    case "latestEpisodeNumbers": {
      const wpShowId = positiveInt(record.wpShowId);
      if (wpShowId == null) {
        throw new PortalWordPressRequestError("latestEpisodeNumbers requires wpShowId");
      }
      return getLatestEpisodeNumbers(wpShowId);
    }
    case "uploadMedia": {
      const filename = requiredString(record.filename);
      const dataBase64 = typeof record.dataBase64 === "string" ? record.dataBase64 : "";
      if (!filename || !dataBase64) {
        throw new PortalWordPressRequestError("uploadMedia requires filename and dataBase64");
      }
      const bytes = Buffer.from(dataBase64, "base64");
      if (bytes.length === 0 || bytes.length > MAX_MEDIA_BYTES) {
        throw new PortalWordPressRequestError("uploadMedia file is empty or too large");
      }
      const contentType =
        typeof record.contentType === "string" && record.contentType.trim()
          ? record.contentType
          : "application/octet-stream";
      const file = new File([new Uint8Array(bytes)], filename, { type: contentType });
      return uploadMedia(file, filename);
    }
    case "verifyEpisode": {
      const tier = record.tier;
      const postId = requiredString(record.postId);
      const wpShowId = positiveInt(record.wpShowId);
      const expectedTitle = typeof record.expectedTitle === "string" ? record.expectedTitle : null;
      if (
        (tier !== 1 && tier !== 2 && tier !== 3 && tier !== 4) ||
        !postId ||
        wpShowId == null ||
        expectedTitle == null
      ) {
        throw new PortalWordPressRequestError(
          "verifyEpisode requires tier, postId, wpShowId, and expectedTitle"
        );
      }
      return websiteVerificationIssuesFromWordPress(tier, postId, {
        jobId: "",
        wpShowId,
        expectedTitle,
        isLiveRecording: record.isLiveRecording === true,
        isPremium: record.isPremium === true,
        premiumSection: record.premiumSection === "og" ? "og" : undefined,
      });
    }
    case "publishOg": {
      const params = ogPublishParams(record.params);
      if (!params) {
        throw new PortalWordPressRequestError("publishOg requires an OG episode payload");
      }
      return publishOgEpisode(params);
    }
    default:
      throw new PortalWordPressRequestError(`Unknown operation: ${op}`);
  }
}
