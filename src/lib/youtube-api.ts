import "server-only";

export interface YouTubePlaylist {
  id: string;
  title: string;
  thumbnail: string;
  itemCount: number;
}

export interface YouTubeChannel {
  channelId: string;
  title: string;
  thumbnail: string;
  subscriberCount: string;
}

/**
 * Fetch all playlists for the authenticated YouTube account.
 */
export async function getYouTubePlaylists(
  accessToken: string
): Promise<YouTubePlaylist[]> {
  const playlists: YouTubePlaylist[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      part: "snippet,contentDetails",
      mine: "true",
      maxResults: "50",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/playlists?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`YouTube playlists API error: ${response.status} — ${body}`);
    }

    const data = await response.json();

    for (const item of data.items ?? []) {
      playlists.push({
        id: item.id,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? "",
        itemCount: item.contentDetails?.itemCount ?? 0,
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return playlists;
}

/**
 * Fetch channel info for the authenticated YouTube account.
 */
export async function getYouTubeChannels(
  accessToken: string
): Promise<YouTubeChannel> {
  const response = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`YouTube channels API error: ${response.status} — ${body}`);
  }

  const data = await response.json();
  const channel = data.items?.[0];

  if (!channel) {
    throw new Error("No YouTube channel found for this account");
  }

  return {
    channelId: channel.id,
    title: channel.snippet.title,
    thumbnail: channel.snippet.thumbnails?.default?.url ?? "",
    subscriberCount: channel.statistics?.subscriberCount ?? "0",
  };
}

export interface YouTubeVideoLiveDetails {
  videoId: string;
  title: string;
  channelId: string;
  liveBroadcastContent: "live" | "upcoming" | "none";
  scheduledStartTime: Date | null;
  actualStartTime: Date | null;
  actualEndTime: Date | null;
  thumbnailUrl: string | null;
}

/**
 * Fetch a single video's snippet + liveStreamingDetails. Used by the
 * live-recording polling cron to detect state transitions and by the
 * create flow to verify a pasted YouTube URL points at a real video.
 *
 * Returns null when the video doesn't exist (no `items` returned).
 * Throws on transport or auth errors so the caller can decide retry vs.
 * surface-to-user.
 */
export async function getVideoLiveDetails(
  accessToken: string,
  videoId: string
): Promise<YouTubeVideoLiveDetails | null> {
  const params = new URLSearchParams({
    part: "snippet,liveStreamingDetails",
    id: videoId,
  });

  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `YouTube videos API error: ${response.status} — ${body}`
    );
  }

  const data = (await response.json()) as {
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        channelId?: string;
        liveBroadcastContent?: string;
        thumbnails?: {
          maxres?: { url?: string };
          high?: { url?: string };
          medium?: { url?: string };
          default?: { url?: string };
        };
      };
      liveStreamingDetails?: {
        scheduledStartTime?: string;
        actualStartTime?: string;
        actualEndTime?: string;
      };
    }>;
  };

  const item = data.items?.[0];
  if (!item) return null;

  const raw = item.snippet?.liveBroadcastContent;
  const liveBroadcastContent: "live" | "upcoming" | "none" =
    raw === "live" || raw === "upcoming" ? raw : "none";

  const thumbnails = item.snippet?.thumbnails ?? {};
  const thumbnailUrl =
    thumbnails.maxres?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    null;

  return {
    videoId: item.id,
    title: item.snippet?.title ?? "",
    channelId: item.snippet?.channelId ?? "",
    liveBroadcastContent,
    scheduledStartTime: parseOptionalDate(
      item.liveStreamingDetails?.scheduledStartTime
    ),
    actualStartTime: parseOptionalDate(
      item.liveStreamingDetails?.actualStartTime
    ),
    actualEndTime: parseOptionalDate(item.liveStreamingDetails?.actualEndTime),
    thumbnailUrl,
  };
}

function parseOptionalDate(input: string | undefined): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}
