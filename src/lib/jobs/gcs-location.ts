import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Which bucket an object lives in, and whether Cloud Run has it mounted.
 *
 * New uploads go to GCS_UPLOAD_BUCKET_NAME when that is set (the regional
 * bucket). Objects written before the cutover stay in GCS_BUCKET_NAME.
 * gcsPath does not include the bucket, so callers pass metadata.gcsBucket
 * when they have it and otherwise check the legacy bucket first.
 *
 * GCS_FUSE_MOUNTS is `bucket=/mount,bucket2=/mount2`. When the object is
 * already on a mount, ffmpeg and the YouTube upload read that path. Cloud
 * Run's writable filesystem is memory-backed and capped at 32 GiB, so a
 * 90 GB episode must not be copied onto local disk.
 */

export function legacyBucketName(): string {
  const bucket = process.env.GCS_BUCKET_NAME?.trim();
  if (!bucket) {
    throw new Error(
      "GCS bucket name not configured. Set GCS_BUCKET_NAME environment variable."
    );
  }
  return bucket;
}

/** Bucket that receives new objects. Falls back to the legacy bucket. */
export function uploadBucketName(): string {
  return process.env.GCS_UPLOAD_BUCKET_NAME?.trim() || legacyBucketName();
}

export function bucketHint(metadata: Record<string, unknown> | null | undefined): string | null {
  const hint = metadata?.gcsBucket;
  return typeof hint === "string" && hint.trim() ? hint.trim() : null;
}

export function parseFuseMounts(raw: string | undefined): Map<string, string> {
  const mounts = new Map<string, string>();
  if (!raw) return mounts;
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const bucket = trimmed.slice(0, eq).trim();
    const mount = trimmed.slice(eq + 1).trim();
    if (bucket && mount) mounts.set(bucket, mount);
  }
  return mounts;
}

/**
 * Absolute path of an object on a configured FUSE mount, when the file is
 * visible. Null when this process has no mount for that bucket (Railway)
 * or the object is not there yet.
 */
export function existingFuseFile(bucket: string, objectPath: string): string | null {
  if (!bucket || !objectPath || objectPath.includes("..") || objectPath.startsWith("/")) {
    return null;
  }
  const mount = parseFuseMounts(process.env.GCS_FUSE_MOUNTS).get(bucket);
  if (!mount) return null;
  const full = join(mount, objectPath);
  return existsSync(full) ? full : null;
}

async function objectExists(objectPath: string, bucket: string): Promise<boolean> {
  const { gcsObjectExists } = await import("@/lib/gcs");
  return gcsObjectExists(objectPath, bucket);
}

/**
 * Resolve the bucket that holds `objectPath`.
 * A stored hint wins. With no second bucket configured, this is the legacy
 * bucket and does not call the API.
 */
export async function resolveObjectBucket(
  objectPath: string,
  hint?: string | null
): Promise<string> {
  if (hint && hint.trim()) return hint.trim();
  const legacy = legacyBucketName();
  const upload = process.env.GCS_UPLOAD_BUCKET_NAME?.trim();
  if (!upload || upload === legacy) return legacy;
  if (await objectExists(objectPath, legacy)) return legacy;
  if (await objectExists(objectPath, upload)) return upload;
  return legacy;
}

export interface LocatedObject {
  /** Set when a second bucket or a FUSE mount is configured. */
  bucket?: string;
  /** Set when the bytes are already readable on a mount. Do not delete this path. */
  fusePath: string | null;
}

/**
 * Cheap when neither GCS_UPLOAD_BUCKET_NAME nor GCS_FUSE_MOUNTS is set:
 * returns immediately so the Railway path does not gain an extra API call.
 */
export async function locateProducerVideo(
  objectPath: string,
  hint?: string | null
): Promise<LocatedObject> {
  const fuseConfigured = Boolean(process.env.GCS_FUSE_MOUNTS?.trim());
  const dual = Boolean(process.env.GCS_UPLOAD_BUCKET_NAME?.trim());
  if (!fuseConfigured && !dual) return { fusePath: null };
  const bucket = await resolveObjectBucket(objectPath, hint);
  return { bucket, fusePath: existingFuseFile(bucket, objectPath) };
}
