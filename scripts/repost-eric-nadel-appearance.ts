/**
 * One-off: repost the Eric Nadel 14th Annual Birthday Bash appearance that
 * failed to upload through the form on 2026-05-16 due to the 10MB server
 * action body limit. Show: Your Dark Companion (wpShowId 21).
 *
 * Inlines the WP REST calls so the script avoids server-only imports —
 * tsx can't load src/lib/wordpress/client.ts directly because of the
 * "server-only" package guard intended for Next.js builds.
 *
 * Compresses iPhone JPEGs with sharp (EXIF rotation + light resize) so
 * WP stores reasonably sized media. Each file uploads as its own request,
 * so the original Next.js 10MB body cap doesn't apply.
 *
 * Usage:
 *   railway run --service swm-producer-portal -- npx tsx scripts/repost-eric-nadel-appearance.ts
 *
 * Defaults to publish status. Pass --draft to land in WP as a draft instead.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import sharp from "sharp";

const WP_SHOW_ID = 21; // Your Dark Companion
const POST_TYPE = "swm_appearance";

const IMAGE_PATHS = [
  "/Users/bretkramer/Downloads/IMG_3548.jpeg",
  "/Users/bretkramer/Downloads/IMG_3547.jpeg",
  "/Users/bretkramer/Downloads/IMG_3546.jpeg",
  "/Users/bretkramer/Downloads/IMG_3545.jpeg",
  "/Users/bretkramer/Downloads/IMG_3544.jpeg",
  "/Users/bretkramer/Downloads/IMG_3542.jpeg",
  "/Users/bretkramer/Downloads/IMG_3541.jpeg",
  "/Users/bretkramer/Downloads/IMG_8617.jpeg",
];

const APPEARANCE = {
  title: "Longhorn Ballroom - Dallas, TX",
  venue: "Longhorn Ballroom",
  location: "Dallas, TX",
  address: "216 Corinth Street, Dallas, TX",
  dateStart: "2026-05-14",
  timeStart: "18:30",
  dateEnd: "2026-05-14",
  timeEnd: "23:00",
  ticketUrl: "",
  eventUrl: "https://www.granthalliburton.org/ericnadel",
  appearanceStatus: "past",
  description:
    "Your Dark Companion recorded on-location at Eric Nadel's 14th Annual Birthday Bash at the Longhorn Ballroom in Dallas — a benefit concert for the Grant Halliburton Foundation, supporting youth mental health and suicide prevention. Performances by Sammy Rae & The Friends and Chuck Prophet.",
};

interface UploadedMedia {
  id: number;
}

interface CreatedPost {
  id: number;
  link?: string;
}

async function main() {
  const draft = process.argv.includes("--draft");
  const status: "publish" | "draft" = draft ? "draft" : "publish";

  const wpUrl = process.env.WP_API_URL;
  const wpUser = process.env.WP_APP_USER;
  const wpPassword = process.env.WP_APP_PASSWORD;
  if (!wpUrl || !wpUser || !wpPassword) {
    console.error(
      "Missing WP_API_URL / WP_APP_USER / WP_APP_PASSWORD — run via `railway run`."
    );
    process.exit(1);
  }

  const auth =
    "Basic " + Buffer.from(`${wpUser}:${wpPassword}`).toString("base64");

  console.log(
    `[repost-eric-nadel] Compressing + uploading ${IMAGE_PATHS.length} images...`
  );

  const galleryIds: number[] = [];
  for (const path of IMAGE_PATHS) {
    const filename = basename(path);
    const original = await readFile(path);

    // Apply EXIF rotation, downscale to 2000px max, re-encode as JPEG q82.
    // Matches the existing compressForWordPress lib's intent without
    // having to import it (server-only barrier).
    const processed = await sharp(original)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    const uploaded = await uploadMediaRaw({
      wpUrl,
      auth,
      buffer: processed,
      filename,
      contentType: "image/jpeg",
    });

    console.log(
      `  ✓ ${filename} — ${formatSize(original.byteLength)} → ${formatSize(processed.byteLength)} — WP media id ${uploaded.id}`
    );
    galleryIds.push(uploaded.id);
  }

  console.log(`[repost-eric-nadel] Creating ${POST_TYPE} post...`);

  const wpPost = await createPostRaw({
    wpUrl,
    auth,
    postType: POST_TYPE,
    payload: {
      title: APPEARANCE.title,
      content: APPEARANCE.description,
      status,
      featured_media: galleryIds[0],
      meta: {
        _swm_portal_submission: true,
        _swm_appearance_show_id: WP_SHOW_ID,
        _swm_appearance_date_start: APPEARANCE.dateStart,
        _swm_appearance_time_start: APPEARANCE.timeStart,
        _swm_appearance_date_end: APPEARANCE.dateEnd,
        _swm_appearance_time_end: APPEARANCE.timeEnd,
        _swm_appearance_venue: APPEARANCE.venue,
        _swm_appearance_location: APPEARANCE.location,
        _swm_appearance_address: APPEARANCE.address,
        _swm_appearance_ticket_url: APPEARANCE.ticketUrl,
        _swm_appearance_event_url: APPEARANCE.eventUrl,
        _swm_appearance_status: APPEARANCE.appearanceStatus,
        _swm_appearance_gallery: galleryIds.join(","),
      },
    },
  });

  // Attach each gallery image to the post so WP associates them
  await Promise.all(
    galleryIds.map((mediaId) =>
      attachMediaRaw({ wpUrl, auth, mediaId, postId: wpPost.id })
    )
  );

  const adminBase = wpUrl.replace("/wp-json/wp/v2", "");
  const editUrl = `${adminBase}/wp-admin/post.php?post=${wpPost.id}&action=edit`;
  const publicUrl = wpPost.link ?? `${adminBase}/?p=${wpPost.id}`;

  console.log(`\n✓ Posted as ${status}.`);
  console.log(`  Public:  ${publicUrl}`);
  console.log(`  Edit:    ${editUrl}`);
  console.log(`  Show:    Your Dark Companion (wpShowId ${WP_SHOW_ID})`);
  console.log(`  Gallery: ${galleryIds.length} images attached`);
}

async function uploadMediaRaw(args: {
  wpUrl: string;
  auth: string;
  buffer: Buffer;
  filename: string;
  contentType: string;
}): Promise<UploadedMedia> {
  const { wpUrl, auth, buffer, filename, contentType } = args;
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: contentType }),
    filename
  );

  const response = await fetch(`${wpUrl}/media`, {
    method: "POST",
    headers: { Authorization: auth },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `WP media upload failed (${response.status}) for ${filename}: ${text}`
    );
  }
  return (await response.json()) as UploadedMedia;
}

async function createPostRaw(args: {
  wpUrl: string;
  auth: string;
  postType: string;
  payload: Record<string, unknown>;
}): Promise<CreatedPost> {
  const { wpUrl, auth, postType, payload } = args;
  const response = await fetch(`${wpUrl}/${postType}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WP post create failed (${response.status}): ${text}`);
  }
  return (await response.json()) as CreatedPost;
}

async function attachMediaRaw(args: {
  wpUrl: string;
  auth: string;
  mediaId: number;
  postId: number;
}): Promise<void> {
  const { wpUrl, auth, mediaId, postId } = args;
  const response = await fetch(`${wpUrl}/media/${mediaId}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ post: postId }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `WP media attach failed (${response.status}) for media ${mediaId}: ${text}`
    );
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

main().catch((err) => {
  console.error("[repost-eric-nadel] Fatal:", err);
  process.exit(1);
});
