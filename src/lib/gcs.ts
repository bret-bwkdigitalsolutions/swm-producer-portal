import { Storage } from "@google-cloud/storage";

let storageInstance: Storage | null = null;

function getStorage(): Storage {
  if (!storageInstance) {
    // Support JSON credentials inline (for Railway/containers) or a file path.
    // The Cloud Run worker sets neither and uses the runtime service account
    // (Application Default Credentials) so the same client reads the FUSE mount.
    const credentialsJson = process.env.GCS_CREDENTIALS_JSON;
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (credentialsJson) {
      let credentials: object;
      try {
        credentials = JSON.parse(credentialsJson);
      } catch {
        throw new Error(
          "GCS_CREDENTIALS_JSON is not valid JSON — check the Railway environment variable"
        );
      }
      storageInstance = new Storage({ credentials });
    } else if (credentialsPath) {
      storageInstance = new Storage({ keyFilename: credentialsPath });
    } else if (process.env.VIDEO_WORKER === "1") {
      storageInstance = new Storage();
    } else {
      throw new Error(
        "Google Cloud credentials not configured. Set GCS_CREDENTIALS_JSON (recommended for Railway) or GOOGLE_APPLICATION_CREDENTIALS."
      );
    }
  }

  return storageInstance;
}

/** Shared client for modules that upload with the Storage library directly. */
export function createStorageClient(): Storage {
  return getStorage();
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
 * Bucket for objects created from now on.
 * Unset GCS_UPLOAD_BUCKET_NAME keeps every write on GCS_BUCKET_NAME.
 */
export function objectBucketForNewUploads(): string {
  return process.env.GCS_UPLOAD_BUCKET_NAME?.trim() || getBucketName();
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
  options?: { resumable?: boolean; bucket?: string }
): Promise<{ uploadUrl: string; gcsPath: string; bucketName: string }> {
  const storage = getStorage();
  const bucketName = options?.bucket?.trim() || objectBucketForNewUploads();
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

  return { uploadUrl: url, gcsPath, bucketName };
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
  expiresInMs: number = 60 * 60 * 1000, // default 1 hour
  bucketName?: string
): Promise<string> {
  const storage = getStorage();
  const resolved = bucketName?.trim() || (await defaultReadBucket(gcsPath));

  const bucket = storage.bucket(resolved);
  const file = bucket.file(gcsPath);

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresInMs,
  });

  return url;
}

/**
 * Upload a file buffer directly to GCS from the server.
 * Use this for small files (thumbnails) to avoid browser CORS / signed-URL issues.
 */
export async function uploadBuffer(
  filename: string,
  buffer: Buffer,
  contentType: string,
  bucketName?: string
): Promise<string> {
  const storage = getStorage();
  const resolved = bucketName?.trim() || objectBucketForNewUploads();
  const gcsPath = generateGcsPath(filename);

  const bucket = storage.bucket(resolved);
  const file = bucket.file(gcsPath);

  await file.save(buffer, {
    contentType,
    resumable: false,
  });

  return gcsPath;
}

/**
 * Whether an object is already stored at `gcsPath`.
 *
 * This is a metadata check, not a media download, so it does not add egress.
 */
export async function gcsObjectExists(
  gcsPath: string,
  bucketName?: string
): Promise<boolean> {
  const storage = getStorage();
  const resolved = bucketName?.trim() || getBucketName();
  const [exists] = await storage.bucket(resolved).file(gcsPath).exists();
  return exists;
}

/**
 * Bucket to read when the caller did not pass one.
 * With only GCS_BUCKET_NAME set, this does not call the API.
 */
async function defaultReadBucket(gcsPath: string): Promise<string> {
  if (!process.env.GCS_UPLOAD_BUCKET_NAME?.trim()) return getBucketName();
  const { resolveObjectBucket } = await import("@/lib/jobs/gcs-location");
  return resolveObjectBucket(gcsPath);
}

/**
 * Delete a file from GCS.
 *
 * @param gcsPath - The path of the file in GCS
 */
async function deleteFromBucket(bucketName: string, gcsPath: string): Promise<void> {
  const storage = getStorage();
  await storage.bucket(bucketName).file(gcsPath).delete({ ignoreNotFound: true });
}

export async function deleteFile(gcsPath: string, bucketName?: string): Promise<void> {
  if (bucketName?.trim()) {
    await deleteFromBucket(bucketName.trim(), gcsPath);
    return;
  }

  const legacy = getBucketName();
  await deleteFromBucket(legacy, gcsPath);
  const upload = process.env.GCS_UPLOAD_BUCKET_NAME?.trim();
  // During dual-read the object may sit in either bucket. Delete is a free
  // operation and ignoreNotFound makes the extra call harmless.
  if (upload && upload !== legacy) {
    await deleteFromBucket(upload, gcsPath);
  }
}
