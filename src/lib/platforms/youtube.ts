import { getYouTubeAccessToken } from "@/lib/analytics/credentials";

const YOUTUBE_UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos";
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";

export interface YouTubeUploadParams {
  wpShowId: number;
  title: string;
  description: string;
  tags: string[];
  privacy: "public" | "unlisted" | "private";
  categoryId?: string; // YouTube category ID, defaults to "22" (People & Blogs)
  videoFilePath: string; // local temp file path
  scheduledAt?: string; // ISO 8601 date — if set, video is private until this time
}

export interface YouTubeUploadResult {
  videoId: string;
  videoUrl: string;
}

/**
 * Upload a video to YouTube using the Data API v3 resumable upload protocol.
 */
export async function uploadToYouTube(
  params: YouTubeUploadParams
): Promise<YouTubeUploadResult> {
  const { wpShowId, title, description, tags, privacy, categoryId, videoFilePath, scheduledAt } = params;

  const accessToken = await getYouTubeAccessToken(wpShowId);
  if (!accessToken) {
    throw new Error(
      `No valid YouTube credentials found for show ${wpShowId}. Please connect YouTube in Admin > Credentials.`
    );
  }

  // 1. Initiate resumable upload session
  // YouTube API rejects titles that are empty or exceed 100 characters
  const safeTitle = title.slice(0, 100);
  console.log(`[youtube] Initiating upload for "${safeTitle}"`);

  const status: Record<string, unknown> = {
    privacyStatus: scheduledAt ? "private" : privacy,
    selfDeclaredMadeForKids: false,
  };
  if (scheduledAt) {
    status.publishAt = scheduledAt;
    console.log(`[youtube] Scheduling publish at ${scheduledAt}`);
  }

  const metadata = {
    snippet: {
      title: safeTitle,
      description,
      tags,
      categoryId: categoryId ?? "22",
    },
    status,
  };

  const initResponse = await fetch(
    `${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/*",
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    throw new Error(
      `YouTube upload initiation failed (${initResponse.status}): ${errorText}`
    );
  }

  const uploadUrl = initResponse.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("YouTube did not return a resumable upload URL.");
  }

  // 2. Upload video file
  console.log("[youtube] Uploading video file...");

  const { createReadStream, statSync } = await import("node:fs");
  const fileSize = statSync(videoFilePath).size;
  const fileStream = createReadStream(videoFilePath);
  const { Readable } = await import("node:stream");

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": fileSize.toString(),
      "Content-Type": "video/*",
    },
    body: Readable.toWeb(fileStream) as any,
    // @ts-expect-error -- Node fetch supports duplex
    duplex: "half",
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(
      `YouTube video upload failed (${uploadResponse.status}): ${errorText}`
    );
  }

  const videoData = await uploadResponse.json();
  const videoId = videoData.id;

  if (!videoId) {
    throw new Error("YouTube upload succeeded but no video ID was returned.");
  }

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`[youtube] Upload complete: ${videoUrl}`);

  return { videoId, videoUrl };
}

/**
 * Set a custom thumbnail on a YouTube video.
 */
export async function setThumbnail(
  wpShowId: number,
  videoId: string,
  thumbnailFilePath: string,
  contentType: string = "image/jpeg"
): Promise<void> {
  const accessToken = await getYouTubeAccessToken(wpShowId);
  if (!accessToken) return;

  const { createReadStream, statSync } = await import("node:fs");
  const fileSize = statSync(thumbnailFilePath).size;
  const fileStream = createReadStream(thumbnailFilePath);
  const { Readable } = await import("node:stream");

  const response = await fetch(
    `${YOUTUBE_UPLOAD_URL.replace("/videos", "/thumbnails/set")}?videoId=${videoId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": contentType,
        "Content-Length": fileSize.toString(),
      },
      body: Readable.toWeb(fileStream) as any,
      // @ts-expect-error -- Node fetch supports duplex
      duplex: "half",
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[youtube] Failed to set thumbnail: ${errorText}`);
    // Non-fatal — video is already uploaded
  } else {
    console.log(`[youtube] Thumbnail set for video ${videoId}`);
  }
}

/**
 * Add a video to a YouTube playlist.
 */
export async function addToPlaylist(
  wpShowId: number,
  playlistId: string,
  videoId: string
): Promise<void> {
  const accessToken = await getYouTubeAccessToken(wpShowId);
  if (!accessToken) return;

  const response = await fetch(
    `${YOUTUBE_API_URL}/playlistItems?part=snippet`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: {
          playlistId,
          resourceId: { kind: "youtube#video", videoId },
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `[youtube] Failed to add to playlist ${playlistId}: ${errorText}`
    );
    // Non-fatal — don't throw
  } else {
    console.log(`[youtube] Added to playlist ${playlistId}`);
  }
}
