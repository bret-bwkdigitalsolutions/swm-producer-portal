import {
  getTransistorApiKey,
  resolvePlatformId,
  parseTransistorShowId,
} from "@/lib/analytics/credentials";
import { generateSignedDownloadUrl } from "@/lib/gcs";

const BASE_URL = "https://api.transistor.fm/v1";

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
  const transistorShowId = parseTransistorShowId(showLink);

  // 1. Get an authorized upload URL from Transistor
  console.log(`[transistor] Requesting upload URL for "${title}"`);

  const authorizeRes = await fetch(`${BASE_URL}/episodes/authorize_upload`, {
    method: "GET",
    headers: { "x-api-key": apiKey },
  });

  if (!authorizeRes.ok) {
    const errorText = await authorizeRes.text();
    throw new Error(
      `Transistor authorize_upload failed (${authorizeRes.status}): ${errorText}`
    );
  }

  const authorizeData = await authorizeRes.json();
  const uploadUrl = authorizeData.data?.attributes?.upload_url;
  const audioUrl = authorizeData.data?.attributes?.content_url;

  if (!uploadUrl || !audioUrl) {
    throw new Error("Transistor did not return upload URL.");
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
      status: "published",
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
  const shareUrl =
    createData.data?.attributes?.share_url ??
    `https://share.transistor.fm/s/${episodeId}`;

  console.log(`[transistor] Episode created: ${shareUrl}`);

  return { episodeId: String(episodeId), episodeUrl: shareUrl };
}
