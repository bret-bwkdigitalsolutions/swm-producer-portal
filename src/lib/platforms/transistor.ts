import {
  getTransistorApiKey,
  resolvePlatformId,
  parseTransistorShowId,
} from "@/lib/analytics/credentials";
import { generateSignedDownloadUrl } from "@/lib/gcs";

const BASE_URL = "https://api.transistor.fm/v1";

/**
 * Resolve a Transistor show's numeric ID. If the stored link is a dashboard URL
 * (slug-based), query the Transistor API to find the matching numeric ID.
 */
async function resolveTransistorShowId(
  apiKey: string,
  showLinkValue: string
): Promise<string> {
  const parsed = parseTransistorShowId(showLinkValue);

  // Already a numeric ID
  if (/^\d+$/.test(parsed)) return parsed;

  // It's a slug — look up all shows and match by slug
  const res = await fetch(`${BASE_URL}/shows`, {
    headers: { "x-api-key": apiKey },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch Transistor shows (${res.status}): ${await res.text()}`
    );
  }

  const data = await res.json();
  const shows = data.data ?? [];

  // Match by slug (last segment of the dashboard URL)
  const match = shows.find(
    (s: { attributes?: { slug?: string } }) =>
      s.attributes?.slug === parsed
  );

  if (match) {
    return String(match.id);
  }

  // If no slug match, the value might still work as-is
  console.warn(
    `[transistor] Could not resolve slug "${parsed}" to a numeric ID. Using as-is.`
  );
  return parsed;
}

export interface TransistorUploadParams {
  wpShowId: number;
  title: string;
  description: string;
  seasonNumber?: number;
  episodeNumber?: number;
  gcsAudioPath: string; // GCS path to the extracted mp3
}

export interface TransistorUploadResult {
  episodeId: string;
  episodeUrl: string;
}

/**
 * Create an episode on Transistor and upload the audio file.
 */
export async function uploadToTransistor(
  params: TransistorUploadParams
): Promise<TransistorUploadResult> {
  const { wpShowId, title, description, seasonNumber, episodeNumber, gcsAudioPath } =
    params;

  const apiKey = await getTransistorApiKey(wpShowId);
  if (!apiKey) {
    throw new Error(
      `No Transistor API key found for show ${wpShowId}. Please add it in Admin > Credentials.`
    );
  }

  const showLink = await resolvePlatformId(wpShowId, "transistor_show");
  if (!showLink) {
    throw new Error(
      `No Transistor show linked for WP show ${wpShowId}. Please configure it in Admin > Shows.`
    );
  }
  const transistorShowId = await resolveTransistorShowId(apiKey, showLink);

  // 1. Get an authorized upload URL from Transistor
  console.log(`[transistor] Requesting upload URL for "${title}"`);

  // Transistor requires a filename to authorize the upload
  const audioFilename = gcsAudioPath.split("/").pop() ?? "episode.mp3";

  const authorizeRes = await fetch(
    `${BASE_URL}/episodes/authorize_upload?filename=${encodeURIComponent(audioFilename)}`,
    {
      method: "GET",
      headers: { "x-api-key": apiKey },
    }
  );

  if (!authorizeRes.ok) {
    const errorText = await authorizeRes.text();
    throw new Error(
      `Transistor authorize_upload failed (${authorizeRes.status}): ${errorText}`
    );
  }

  const authorizeData = await authorizeRes.json();
  console.log("[transistor] authorize_upload response:", JSON.stringify(authorizeData).slice(0, 500));

  const uploadUrl = authorizeData.data?.attributes?.upload_url;
  const audioUrl = authorizeData.data?.attributes?.content_url ?? authorizeData.data?.attributes?.audio_url;

  if (!uploadUrl || !audioUrl) {
    throw new Error(
      `Transistor did not return upload URL. Response keys: ${JSON.stringify(Object.keys(authorizeData.data?.attributes ?? {}))}`
    );
  }

  // 2. Upload audio file to Transistor's S3
  console.log("[transistor] Uploading audio file...");

  const downloadUrl = await generateSignedDownloadUrl(gcsAudioPath);
  const audioResponse = await fetch(downloadUrl);
  if (!audioResponse.ok || !audioResponse.body) {
    throw new Error("Failed to download audio from GCS.");
  }

  const audioBuffer = await audioResponse.arrayBuffer();

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "audio/mpeg" },
    body: audioBuffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`Transistor audio upload failed (${uploadRes.status})`);
  }

  // 3. Create the episode with the uploaded audio URL
  console.log("[transistor] Creating episode...");

  const episodePayload: Record<string, unknown> = {
    episode: {
      show_id: transistorShowId,
      title,
      summary: description,
      audio_url: audioUrl,
    },
  };

  if (seasonNumber) {
    (episodePayload.episode as Record<string, unknown>).season = seasonNumber;
  }
  if (episodeNumber) {
    (episodePayload.episode as Record<string, unknown>).number = episodeNumber;
  }

  const createRes = await fetch(`${BASE_URL}/episodes`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(episodePayload),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(
      `Transistor episode creation failed (${createRes.status}): ${errorText}`
    );
  }

  const createData = await createRes.json();
  const episodeId = createData.data?.id;

  if (!episodeId) {
    throw new Error("Transistor did not return an episode ID.");
  }

  // 4. Publish the episode (Transistor creates as draft by default)
  console.log(`[transistor] Publishing episode ${episodeId}...`);
  const publishRes = await fetch(`${BASE_URL}/episodes/${episodeId}/publish`, {
    method: "PATCH",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      episode: { status: "published" },
    }),
  });

  if (!publishRes.ok) {
    console.warn(
      `[transistor] Publish failed (${publishRes.status}), episode remains as draft`
    );
  }

  const shareUrl =
    createData.data?.attributes?.share_url ??
    `https://share.transistor.fm/s/${episodeId}`;

  console.log(`[transistor] Episode published: ${shareUrl}`);

  return { episodeId: String(episodeId), episodeUrl: shareUrl };
}
