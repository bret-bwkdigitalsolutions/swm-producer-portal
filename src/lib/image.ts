import sharp from "sharp";
import { generateSignedDownloadUrl, uploadBuffer } from "@/lib/gcs";

/**
 * Platform-specific image requirements:
 * - YouTube:    1280×720 (16:9) — handled by YouTube itself, we just upload the original
 * - Transistor: 1400×1400 min, 3000×3000 max, square (1:1), JPEG
 * - WordPress:  1200px wide recommended, JPEG/WebP
 */

export interface ProcessedImage {
  buffer: Uint8Array;
  contentType: string;
  width: number;
  height: number;
}

/**
 * Download an image from GCS and return it as a Buffer.
 */
async function downloadFromGcs(gcsPath: string): Promise<Buffer> {
  const url = await generateSignedDownloadUrl(gcsPath);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image from GCS (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Resize and crop an image to a square for Transistor/podcast platforms.
 * Crops from center, targets 3000×3000 (or source size if smaller than 3000,
 * but at least 1400×1400). Output is always JPEG for broad compatibility.
 */
export async function prepareForTransistor(
  gcsPath: string
): Promise<ProcessedImage> {
  const source = await downloadFromGcs(gcsPath);
  const metadata = await sharp(source).metadata();
  const srcWidth = metadata.width ?? 0;
  const srcHeight = metadata.height ?? 0;

  // Crop to the largest centered square
  const squareSize = Math.min(srcWidth, srcHeight);

  // Target size: clamp between 1400 and 3000
  const targetSize = Math.min(Math.max(squareSize, 1400), 3000);

  const result = await sharp(source)
    .resize(targetSize, targetSize, {
      fit: "cover", // center-crop to fill the square
      position: "centre",
    })
    .jpeg({ quality: 90 })
    .toBuffer();

  return {
    buffer: result,
    contentType: "image/jpeg",
    width: targetSize,
    height: targetSize,
  };
}

/**
 * Process a thumbnail for Transistor: crop to square, upload to GCS,
 * and return a signed download URL (4-hour expiry for async processing).
 */
export async function prepareTransistorImageUrl(
  gcsPath: string
): Promise<string> {
  const processed = await prepareForTransistor(gcsPath);
  const squarePath = await uploadBuffer(
    `transistor-square-${Date.now()}.jpg`,
    Buffer.from(processed.buffer),
    processed.contentType
  );
  return generateSignedDownloadUrl(squarePath, 4 * 60 * 60 * 1000);
}

/**
 * Compress a File for WordPress upload.
 * Resizes to max 1200px wide, converts to JPEG at 85% quality.
 * Returns a new File object ready for the WP REST API.
 */
export async function compressForWordPress(file: File): Promise<File> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(buffer).metadata();
  const srcWidth = metadata.width ?? 0;
  const targetWidth = Math.min(srcWidth, 1200);

  const result = await sharp(buffer)
    .rotate() // auto-rotate based on EXIF orientation
    .resize(targetWidth, undefined, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  // Replace extension with .jpg
  const name = file.name.replace(/\.[^.]+$/, ".jpg");
  return new File([new Uint8Array(result)], name, { type: "image/jpeg" });
}

/**
 * Resize an image for WordPress featured images.
 * Maintains aspect ratio, scales to 1200px wide, outputs as JPEG.
 */
export async function prepareForWordPress(
  gcsPath: string
): Promise<ProcessedImage> {
  const source = await downloadFromGcs(gcsPath);
  const metadata = await sharp(source).metadata();
  const srcWidth = metadata.width ?? 0;

  // Only resize if wider than 1200px — no upscaling
  const targetWidth = Math.min(srcWidth, 1200);

  const result = await sharp(source)
    .resize(targetWidth, undefined, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    .toBuffer();

  const outputMeta = await sharp(result).metadata();

  return {
    buffer: result,
    contentType: "image/jpeg",
    width: outputMeta.width ?? targetWidth,
    height: outputMeta.height ?? 0,
  };
}
