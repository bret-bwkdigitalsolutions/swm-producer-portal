import { Storage } from "@google-cloud/storage";

let storageInstance: Storage | null = null;

function getStorage(): Storage {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!credentialsPath) {
    console.warn(
      "[GCS] GOOGLE_APPLICATION_CREDENTIALS is not set. GCS operations will fail."
    );
    throw new Error(
      "Google Cloud credentials not configured. Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service account key file."
    );
  }

  if (!storageInstance) {
    storageInstance = new Storage({
      keyFilename: credentialsPath,
    });
  }

  return storageInstance;
}

function getBucketName(): string {
  const bucket = process.env.GCS_BUCKET_NAME;

  if (!bucket) {
    console.warn("[GCS] GCS_BUCKET_NAME is not set. GCS operations will fail.");
    throw new Error(
      "GCS bucket name not configured. Set GCS_BUCKET_NAME environment variable."
    );
  }

  return bucket;
}

/**
 * Generate a unique GCS path for a file upload.
 * Format: uploads/{year}/{month}/{timestamp}-{sanitized-filename}
 */
function generateGcsPath(filename: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const timestamp = now.getTime();
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `uploads/${year}/${month}/${timestamp}-${sanitized}`;
}

/**
 * Generate a signed URL for uploading a file directly to GCS.
 * The URL is valid for 1 hour and supports resumable uploads.
 *
 * @param filename - Original filename (used to generate GCS path)
 * @param contentType - MIME type of the file (e.g., "video/mp4")
 * @returns Object with the signed upload URL and the GCS path
 */
export async function generateSignedUploadUrl(
  filename: string,
  contentType: string
): Promise<{ uploadUrl: string; gcsPath: string }> {
  const storage = getStorage();
  const bucketName = getBucketName();
  const gcsPath = generateGcsPath(filename);

  const bucket = storage.bucket(bucketName);
  const file = bucket.file(gcsPath);

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "resumable",
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
    contentType,
  });

  return { uploadUrl: url, gcsPath };
}

/**
 * Generate a signed URL for downloading/reading a file from GCS.
 * The URL is valid for 1 hour.
 *
 * @param gcsPath - The path of the file in GCS
 * @returns Signed download URL
 */
export async function generateSignedDownloadUrl(
  gcsPath: string
): Promise<string> {
  const storage = getStorage();
  const bucketName = getBucketName();

  const bucket = storage.bucket(bucketName);
  const file = bucket.file(gcsPath);

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
  });

  return url;
}

/**
 * Delete a file from GCS.
 *
 * @param gcsPath - The path of the file in GCS
 */
export async function deleteFile(gcsPath: string): Promise<void> {
  const storage = getStorage();
  const bucketName = getBucketName();

  const bucket = storage.bucket(bucketName);
  const file = bucket.file(gcsPath);

  await file.delete({ ignoreNotFound: true });
}
