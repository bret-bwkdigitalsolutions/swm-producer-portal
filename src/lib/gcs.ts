import { Storage } from "@google-cloud/storage";

let storageInstance: Storage | null = null;

function getStorage(): Storage {
  if (!storageInstance) {
    // Support JSON credentials inline (for Railway/containers) or a file path
    const credentialsJson = process.env.GCS_CREDENTIALS_JSON;
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (credentialsJson) {
      const credentials = JSON.parse(credentialsJson);
      storageInstance = new Storage({ credentials });
    } else if (credentialsPath) {
      storageInstance = new Storage({ keyFilename: credentialsPath });
    } else {
      throw new Error(
        "Google Cloud credentials not configured. Set GCS_CREDENTIALS_JSON (recommended for Railway) or GOOGLE_APPLICATION_CREDENTIALS."
      );
    }
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
  contentType: string,
  options?: { resumable?: boolean }
): Promise<{ uploadUrl: string; gcsPath: string }> {
  const storage = getStorage();
  const bucketName = getBucketName();
  const gcsPath = generateGcsPath(filename);

  const bucket = storage.bucket(bucketName);
  const file = bucket.file(gcsPath);

  const resumable = options?.resumable ?? true;

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: resumable ? "resumable" : "write",
    expires: Date.now() + 4 * 60 * 60 * 1000, // 4 hours
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
  gcsPath: string,
  expiresInMs: number = 60 * 60 * 1000 // default 1 hour
): Promise<string> {
  const storage = getStorage();
  const bucketName = getBucketName();

  const bucket = storage.bucket(bucketName);
  const file = bucket.file(gcsPath);

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresInMs,
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
