/**
 * One-off: re-crop IMG_3548 (the wide podcast-table shot) to a 16:9 hero
 * variant and swap it into post 2683 as the new hero image. The Your Dark
 * Companion appearance theme picks the LAST entry of _swm_appearance_gallery
 * meta as the hero background, so we append the new media ID at the end.
 *
 * Usage:
 *   railway run --service swm-producer-portal -- npx tsx scripts/fix-eric-nadel-hero.ts
 */

import { readFile } from "node:fs/promises";
import sharp from "sharp";

const POST_ID = 2683;
const SOURCE_PATH = "/Users/bretkramer/Downloads/IMG_3548.jpeg";
const POST_TYPE = "swm_appearance";

async function main() {
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

  console.log("[fix-hero] Cropping IMG_3548 to 16:9 hero variant...");

  const original = await readFile(SOURCE_PATH);
  const meta = await sharp(original).rotate().metadata();
  const srcW = meta.width!;
  const srcH = meta.height!;

  // 16:9 crop, centered. Source 4032x3024 (4:3) → keep full width, trim
  // top/bottom equally. Subject (hosts behind table) sits in middle band so
  // a center crop frames them well.
  const targetRatio = 16 / 9;
  let cropW = srcW;
  let cropH = Math.round(srcW / targetRatio);
  let left = 0;
  let top = Math.round((srcH - cropH) / 2);
  if (cropH > srcH) {
    // source already wider than 16:9 — crop sides instead
    cropH = srcH;
    cropW = Math.round(srcH * targetRatio);
    top = 0;
    left = Math.round((srcW - cropW) / 2);
  }

  const cropped = await sharp(original)
    .rotate()
    .extract({ left, top, width: cropW, height: cropH })
    .resize({ width: 2000, height: 1125, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  console.log(
    `  Source ${srcW}x${srcH} → cropped ${cropW}x${cropH} → encoded ${(cropped.byteLength / 1024).toFixed(1)} KB`
  );

  console.log("[fix-hero] Uploading new hero variant to WP media...");

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(cropped)], { type: "image/jpeg" }),
    "IMG_3548-hero-16x9.jpeg"
  );

  const uploadResp = await fetch(`${wpUrl}/media`, {
    method: "POST",
    headers: { Authorization: auth },
    body: form,
  });
  if (!uploadResp.ok) {
    throw new Error(
      `WP media upload failed (${uploadResp.status}): ${await uploadResp.text()}`
    );
  }
  const uploaded = (await uploadResp.json()) as { id: number };
  console.log(`  Uploaded as media id ${uploaded.id}`);

  console.log(`[fix-hero] Fetching current gallery meta on post ${POST_ID}...`);

  const postResp = await fetch(
    `${wpUrl}/${POST_TYPE}/${POST_ID}?context=edit`,
    { headers: { Authorization: auth } }
  );
  if (!postResp.ok) {
    throw new Error(
      `WP post fetch failed (${postResp.status}): ${await postResp.text()}`
    );
  }
  const post = (await postResp.json()) as {
    meta?: Record<string, unknown>;
  };
  const currentGallery = String(post.meta?._swm_appearance_gallery ?? "")
    .split(",")
    .filter(Boolean)
    .map((s) => s.trim());
  console.log(`  Current gallery: [${currentGallery.join(", ")}]`);

  // Append the new hero ID at the END so the theme picks it as the hero.
  const newGallery = [...currentGallery, String(uploaded.id)].join(",");

  console.log(`[fix-hero] Updating post ${POST_ID}...`);

  const updateResp = await fetch(`${wpUrl}/${POST_TYPE}/${POST_ID}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      featured_media: uploaded.id,
      meta: {
        _swm_appearance_gallery: newGallery,
      },
    }),
  });
  if (!updateResp.ok) {
    throw new Error(
      `WP post update failed (${updateResp.status}): ${await updateResp.text()}`
    );
  }

  // Attach the new media to the post
  await fetch(`${wpUrl}/media/${uploaded.id}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ post: POST_ID }),
  });

  const adminBase = wpUrl.replace("/wp-json/wp/v2", "");
  console.log(`\n✓ Hero swapped on post ${POST_ID}.`);
  console.log(`  Public:  ${adminBase}/appearances/longhorn-ballroom-dallas-tx/`);
  console.log(
    `  Edit:    ${adminBase}/wp-admin/post.php?post=${POST_ID}&action=edit`
  );
  console.log(`  Gallery: ${newGallery.split(",").length} items (new hero last)`);
}

main().catch((err) => {
  console.error("[fix-hero] Fatal:", err);
  process.exit(1);
});
