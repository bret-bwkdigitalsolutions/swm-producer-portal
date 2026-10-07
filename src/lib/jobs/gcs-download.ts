import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { generateSignedDownloadUrl } from "@/lib/gcs";

export interface DownloadGcsObjectOptions {
  /**
   * Prefix for the error thrown when GCS returns a non-OK response.
   * Defaults to "Failed to download video" so existing caller messages stay
   * the same (`Failed to download video: 500`).
   */
  errorPrefix?: string;
  /** Bucket that holds the object. Omit to use the default read bucket. */
  bucket?: string;
}

/**
 * Read one GCS object fully onto local disk.
 *
 * Callers that need the same object more than once (audio extraction and the
 * YouTube upload) must share the resulting file. A second call is a second
 * billed download.
 *
 * The caller owns `destPath` and is responsible for deleting it.
 */
export async function downloadGcsObjectToFile(
  gcsPath: string,
  destPath: string,
  options?: DownloadGcsObjectOptions
): Promise<void> {
  const downloadUrl = options?.bucket
    ? await generateSignedDownloadUrl(gcsPath, 60 * 60 * 1000, options.bucket)
    : await generateSignedDownloadUrl(gcsPath);
  const response = await fetch(downloadUrl);
  if (!response.ok || !response.body) {
    const prefix = options?.errorPrefix ?? "Failed to download video";
    throw new Error(`${prefix}: ${response.status}`);
  }

  // DOM fetch's ReadableStream and node:stream/web's are nominally different types.
  const webBody = response.body as unknown as NodeWebReadableStream<Uint8Array>;
  await pipeline(Readable.fromWeb(webBody), createWriteStream(destPath));
}
