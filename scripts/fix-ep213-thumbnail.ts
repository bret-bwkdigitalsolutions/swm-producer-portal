/**
 * One-off script: Update Ep 213 (YDC) with correct thumbnail and title
 * on Transistor, WordPress, and YouTube.
 *
 * Fully self-contained — no project imports (avoids server-only / path issues).
 *
 * Run with: railway run -- npx tsx /Users/bretkramer/Development/bwk-digital/swm-producer-portal/scripts/fix-ep213-thumbnail.ts
 */

import pg from "pg";
import sharp from "sharp";
import { Storage } from "@google-cloud/storage";
import { readFileSync } from "node:fs";

// --- Constants ---
const TRANSISTOR_EPISODE_ID = "3173302";
const WP_POST_ID = 2435;
const WP_SHOW_ID = 21;
const JOB_ID = "cmo0m0fq8000201rs32vgzhj9";
const NEW_TITLE =
  "From the Greatest High School Game Ever to Friday Night Lights Forever | Eddy Clinton & Brad Leland";
const THUMBNAIL_PATH =
  "/Users/bretkramer/Library/Messages/Attachments/75/05/D5EF23F4-91C6-487A-BFCC-2E12664477C6/Ep 212 video.png";

// --- Inline helpers (no project imports) ---

function getStorage(): Storage {
  const credentialsJson = process.env.GCS_CREDENTIALS_JSON;
  if (credentialsJson) {
    return new Storage({ credentials: JSON.parse(credentialsJson) });
  }
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsPath) {
    return new Storage({ keyFilename: credentialsPath });
  }
  throw new Error("No GCS credentials configured");
}

async function uploadBuffer(filename: string, buffer: Buffer, contentType: string): Promise<string> {
  const storage = getStorage();
  const bucket = storage.bucket(process.env.GCS_BUCKET_NAME!);
  const now = new Date();
  const gcsPath = `uploads/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getTime()}-${filename}`;
  await bucket.file(gcsPath).save(buffer, { contentType, resumable: false });
  return gcsPath;
}

async function getSignedUrl(gcsPath: string, expiresInMs = 4 * 60 * 60 * 1000): Promise<string> {
  const storage = getStorage();
  const [url] = await storage
    .bucket(process.env.GCS_BUCKET_NAME!)
    .file(gcsPath)
    .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + expiresInMs });
  return url;
}

async function getYouTubeAccessToken(pool: pg.Pool, wpShowId: number): Promise<string | null> {
  let row = await pool.query(
    `SELECT "refreshToken" FROM platform_credentials WHERE "wpShowId" = $1 AND platform = 'youtube'`,
    [wpShowId]
  );
  if (!row.rows[0]?.refreshToken && wpShowId !== 0) {
    row = await pool.query(
      `SELECT "refreshToken" FROM platform_credentials WHERE "wpShowId" = 0 AND platform = 'youtube'`
    );
  }
  const refreshToken = row.rows[0]?.refreshToken;
  if (!refreshToken) return null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    console.error(`  Token refresh failed: ${response.status} — ${await response.text()}`);
    return null;
  }
  return ((await response.json()) as { access_token: string }).access_token;
}

// --- Main ---

async function main() {
  const dbUrl =
    process.env.DATABASE_PUBLIC_URL ??
    process.env.DATABASE_URL?.replace(
      "postgres.railway.internal:5432",
      "crossover.proxy.rlwy.net:57250"
    );
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

  // --- Transistor ---
  console.log("\n--- Transistor ---");
  const credRow = await pool.query(
    `SELECT "apiKey" FROM platform_credentials WHERE "wpShowId" = $1 AND platform = 'transistor'`,
    [WP_SHOW_ID]
  );
  const transistorApiKey = credRow.rows[0]?.apiKey;
  if (!transistorApiKey) {
    console.error("No Transistor API key found!");
  } else {
    // Process to square for Transistor
    console.log("Processing square image for Transistor...");
    const meta = await sharp(imageBuffer).metadata();
    const squareSize = Math.min(meta.width ?? 0, meta.height ?? 0);
    const targetSize = Math.min(Math.max(squareSize, 1400), 3000);
    const squareBuffer = await sharp(imageBuffer)
      .resize(targetSize, targetSize, { fit: "cover", position: "centre" })
      .jpeg({ quality: 90 })
      .toBuffer();

    const squareGcsPath = await uploadBuffer("ep213-transistor-square.jpg", squareBuffer, "image/jpeg");
    const squareUrl = await getSignedUrl(squareGcsPath);

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
          episode: { title: NEW_TITLE, image_url: squareUrl },
        }),
      }
    );

    if (transistorRes.ok) {
      console.log("  Transistor updated!");
    } else {
      console.error(`  Transistor failed (${transistorRes.status}): ${await transistorRes.text()}`);
    }
  }

  // --- WordPress ---
  console.log("\n--- WordPress ---");
  const wpApiUrl = process.env.WP_API_URL!;
  const wpAuth =
    "Basic " +
    Buffer.from(`${process.env.WP_APP_USER}:${process.env.WP_APP_PASSWORD}`).toString("base64");

  // Resize for WordPress
  console.log("Processing image for WordPress...");
  const wpBuffer = await sharp(imageBuffer)
    .resize(1200, undefined, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();

  console.log("Uploading featured image to WordPress...");
  const filename = "ep-213-from-greatest-high-school-game.jpg";
  const file = new File([new Uint8Array(wpBuffer)], filename, { type: "image/jpeg" });
  const formData = new FormData();
  formData.append("file", file, filename);

  const mediaRes = await fetch(`${wpApiUrl}/media`, {
    method: "POST",
    headers: { Authorization: wpAuth },
    body: formData,
  });

  if (!mediaRes.ok) {
    console.error(`  Media upload failed: ${mediaRes.status} — ${await mediaRes.text().catch(() => "")}`);
  } else {
    const media = (await mediaRes.json()) as { id: number };
    console.log(`  Media uploaded: ID ${media.id}`);

    console.log("Updating WordPress post...");
    const wpRes = await fetch(`${wpApiUrl}/swm_episode/${WP_POST_ID}`, {
      method: "POST",
      headers: { Authorization: wpAuth, "Content-Type": "application/json" },
      body: JSON.stringify({ title: NEW_TITLE, featured_media: media.id }),
    });

    if (wpRes.ok) {
      const wpPost = (await wpRes.json()) as { link: string };
      console.log(`  WordPress updated! URL: ${wpPost.link}`);
    } else {
      console.error(`  WordPress update failed (${wpRes.status}): ${await wpRes.text()}`);
    }
  }

  // --- YouTube ---
  console.log("\n--- YouTube ---");
  const ytRow = await pool.query(
    `SELECT "externalId", "externalUrl" FROM distribution_job_platforms WHERE "jobId" = $1 AND platform = 'youtube'`,
    [JOB_ID]
  );
  const youtubeVideoId = ytRow.rows[0]?.externalId;
  if (!youtubeVideoId) {
    console.error("  No YouTube video ID found for this job — skipping");
  } else {
    console.log(`  YouTube video ID: ${youtubeVideoId}`);
    const accessToken = await getYouTubeAccessToken(pool, WP_SHOW_ID);
    if (!accessToken) {
      console.error("  Could not get YouTube access token — skipping");
    } else {
      // Update title
      console.log("  Updating YouTube title...");
      const ytUpdateRes = await fetch(
        "https://www.googleapis.com/youtube/v3/videos?part=snippet",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: youtubeVideoId,
            snippet: { title: NEW_TITLE, categoryId: "22" },
          }),
        }
      );

      if (ytUpdateRes.ok) {
        console.log("  YouTube title updated!");
      } else {
        console.error(`  YouTube title failed (${ytUpdateRes.status}): ${await ytUpdateRes.text()}`);
      }

      // Set thumbnail
      console.log("  Uploading YouTube thumbnail...");
      const ytThumbRes = await fetch(
        `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${youtubeVideoId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "image/png",
            "Content-Length": imageBuffer.length.toString(),
          },
          body: imageBuffer,
        }
      );

      if (ytThumbRes.ok) {
        console.log("  YouTube thumbnail set!");
      } else {
        console.error(`  YouTube thumbnail failed (${ytThumbRes.status}): ${await ytThumbRes.text()}`);
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
