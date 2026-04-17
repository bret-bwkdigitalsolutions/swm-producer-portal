/**
 * One-off script: Update Ep 213 (YDC) with correct thumbnail and title
 * on Transistor, WordPress, and YouTube.
 *
 * Run with: railway run -- npx tsx scripts/fix-ep213-thumbnail.ts
 *
 * Uses DATABASE_PUBLIC_URL (not DATABASE_URL) to connect from outside Railway.
 */

import pg from "pg";
import { uploadBuffer, generateSignedDownloadUrl } from "../src/lib/gcs";
import { prepareForTransistor, prepareForWordPress } from "../src/lib/image";
import { getYouTubeAccessToken } from "../src/lib/analytics/credentials";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TRANSISTOR_EPISODE_ID = "3173302";
const WP_POST_ID = 2435;
const WP_SHOW_ID = 21;
const JOB_ID = "cmo0m0fq8000201rs32vgzhj9";
const NEW_TITLE =
  "From the Greatest High School Game Ever to Friday Night Lights Forever | Eddy Clinton & Brad Leland";
const THUMBNAIL_PATH =
  "/Users/bretkramer/Library/Messages/Attachments/75/05/D5EF23F4-91C6-487A-BFCC-2E12664477C6/Ep 212 video.png";

async function main() {
  // Connect to DB via public proxy (reachable from outside Railway's private network)
  const dbUrl = process.env.DATABASE_PUBLIC_URL
    ?? process.env.DATABASE_URL?.replace("postgres.railway.internal:5432", "crossover.proxy.rlwy.net:57250");
  if (!dbUrl) throw new Error("No DATABASE_URL available");
  const pool = new pg.Pool({ connectionString: dbUrl });

  console.log("Reading thumbnail...");
  const imageBuffer = readFileSync(THUMBNAIL_PATH);

  // Upload original to GCS
  console.log("Uploading original to GCS...");
  const gcsPath = await uploadBuffer("ep213-thumbnail.png", imageBuffer, "image/png");
  console.log(`  GCS path: ${gcsPath}`);

  // Update job metadata
  console.log("Updating job metadata...");
  const jobRow = await pool.query(
    `SELECT metadata FROM distribution_jobs WHERE id = $1`,
    [JOB_ID]
  );
  if (jobRow.rows.length > 0) {
    const meta = jobRow.rows[0].metadata ?? {};
    meta.thumbnailGcsPath = gcsPath;
    await pool.query(
      `UPDATE distribution_jobs SET metadata = $1, title = $2 WHERE id = $3`,
      [JSON.stringify(meta), NEW_TITLE, JOB_ID]
    );
    console.log("  Job metadata updated");
  }

  // Get Transistor API key
  console.log("\n--- Transistor ---");
  const credRow = await pool.query(
    `SELECT "apiKey" FROM platform_credentials WHERE "wpShowId" = $1 AND platform = 'transistor'`,
    [WP_SHOW_ID]
  );
  const transistorApiKey = credRow.rows[0]?.apiKey;
  if (!transistorApiKey) {
    console.error("No Transistor API key found!");
    process.exit(1);
  }

  // Process image to square for Transistor
  console.log("Processing square image for Transistor...");
  const squareImage = await prepareForTransistor(gcsPath);
  console.log(`  Square image: ${squareImage.width}x${squareImage.height}`);

  const squareGcsPath = await uploadBuffer(
    "ep213-transistor-square.jpg",
    Buffer.from(squareImage.buffer),
    squareImage.contentType
  );
  const squareUrl = await generateSignedDownloadUrl(squareGcsPath, 4 * 60 * 60 * 1000);

  // Update Transistor episode
  console.log("Updating Transistor episode...");
  const transistorRes = await fetch(
    `https://api.transistor.fm/v1/episodes/${TRANSISTOR_EPISODE_ID}`,
    {
      method: "PATCH",
      headers: {
        "x-api-key": transistorApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        episode: {
          title: NEW_TITLE,
          image_url: squareUrl,
        },
      }),
    }
  );

  if (transistorRes.ok) {
    console.log("  Transistor updated successfully!");
  } else {
    const errText = await transistorRes.text();
    console.error(`  Transistor update failed (${transistorRes.status}): ${errText}`);
  }

  // --- WordPress ---
  console.log("\n--- WordPress ---");
  const wpApiUrl = process.env.WP_API_URL!;
  const wpAuth =
    "Basic " +
    Buffer.from(
      `${process.env.WP_APP_USER}:${process.env.WP_APP_PASSWORD}`
    ).toString("base64");

  // Process image for WordPress
  console.log("Processing image for WordPress...");
  const wpImage = await prepareForWordPress(gcsPath);
  console.log(`  WP image: ${wpImage.width}x${wpImage.height}`);

  // Upload as media
  console.log("Uploading featured image to WordPress...");
  const filename = "ep-213-from-greatest-high-school-game.jpg";
  const file = new File([new Uint8Array(wpImage.buffer)], filename, {
    type: wpImage.contentType,
  });
  const formData = new FormData();
  formData.append("file", file, filename);

  const mediaRes = await fetch(`${wpApiUrl}/media`, {
    method: "POST",
    headers: { Authorization: wpAuth },
    body: formData,
  });

  if (!mediaRes.ok) {
    const body = await mediaRes.text().catch(() => "Unknown error");
    console.error(`  Media upload failed: ${mediaRes.status} — ${body}`);
    process.exit(1);
  }
  const media = (await mediaRes.json()) as { id: number };
  console.log(`  Media uploaded: ID ${media.id}`);

  // Update the WP post with new title and featured image
  console.log("Updating WordPress post...");
  const wpRes = await fetch(`${wpApiUrl}/swm_episode/${WP_POST_ID}`, {
    method: "POST",
    headers: {
      Authorization: wpAuth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: NEW_TITLE,
      featured_media: media.id,
    }),
  });

  if (wpRes.ok) {
    const wpPost = (await wpRes.json()) as { link: string };
    console.log(`  WordPress updated! URL: ${wpPost.link}`);
  } else {
    const errText = await wpRes.text();
    console.error(`  WordPress update failed (${wpRes.status}): ${errText}`);
  }

  // --- YouTube ---
  console.log("\n--- YouTube ---");

  // Look up the YouTube video ID from the platform record
  const ytRow = await pool.query(
    `SELECT "externalId", "externalUrl" FROM distribution_job_platforms WHERE "jobId" = $1 AND platform = 'youtube'`,
    [JOB_ID]
  );
  const youtubeVideoId = ytRow.rows[0]?.externalId;
  if (!youtubeVideoId) {
    console.error("  No YouTube video ID found for this job — skipping YouTube");
  } else {
    console.log(`  YouTube video ID: ${youtubeVideoId}`);

    const accessToken = await getYouTubeAccessToken(WP_SHOW_ID);
    if (!accessToken) {
      console.error("  Could not get YouTube access token — skipping");
    } else {
      // Update title via videos.update
      console.log("  Updating YouTube title...");
      const ytUpdateRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: youtubeVideoId,
            snippet: {
              title: NEW_TITLE,
              categoryId: "22",
            },
          }),
        }
      );

      if (ytUpdateRes.ok) {
        console.log("  YouTube title updated!");
      } else {
        const errText = await ytUpdateRes.text();
        console.error(`  YouTube title update failed (${ytUpdateRes.status}): ${errText}`);
      }

      // Set thumbnail
      console.log("  Uploading YouTube thumbnail...");
      const thumbBuffer = readFileSync(THUMBNAIL_PATH);
      const ytThumbRes = await fetch(
        `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${youtubeVideoId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "image/png",
            "Content-Length": thumbBuffer.length.toString(),
          },
          body: thumbBuffer,
        }
      );

      if (ytThumbRes.ok) {
        console.log("  YouTube thumbnail set!");
      } else {
        const errText = await ytThumbRes.text();
        console.error(`  YouTube thumbnail failed (${ytThumbRes.status}): ${errText}`);
      }
    }
  }

  await pool.end();
  console.log("\nDone!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
