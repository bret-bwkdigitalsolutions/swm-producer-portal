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
