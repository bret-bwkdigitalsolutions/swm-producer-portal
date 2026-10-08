import { createReadStream, createWriteStream, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Media uploads go through node:http, not fetch().
 *
 * On Node 20, `fetch(PUT, { body: stream, duplex: "half" })` retains every
 * byte it has sent. A multi-gigabyte episode then grows RSS until Cloud Run
 * hits its memory limit and SIGKILLs the worker. Piping a file through
 * node:http keeps only the socket buffer resident.
 *
 * YouTube's resumable protocol sends fixed-size chunks (a multiple of
 * 256 KiB). After a 5xx or a dropped connection the client asks the session
 * how far it committed and continues from that byte.
 */

/** YouTube requires every non-final chunk to be a multiple of this. */
export const UPLOAD_CHUNK_ALIGNMENT_BYTES = 256 * 1024;

/** Inside YouTube's recommended 8–64 MiB window, and a multiple of 256 KiB. */
export const DEFAULT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

const MAX_UPLOAD_CHUNK_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_REDIRECTS = 3;

export interface UploadHttpResult {
  statusCode: number;
  body: string;
}

export interface UploadProgress {
  (uploadedBytes: number, totalBytes: number): void | Promise<void>;
}

export interface ChunkedUploadOptions {
  uploadUrl: string;
  filePath: string;
  contentType: string;
  /**
   * Multiple of 256 KiB, at most 64 MiB. Defaults to 8 MiB.
   * Tests pass 256 KiB so a failure can land between chunks without a huge file.
   */
  chunkSizeBytes?: number;
  maxAttempts?: number;
  requestTimeoutMs?: number;
  backoffMs?: (attempt: number) => number;
  onProgress?: UploadProgress;
}

export interface StreamFilePutOptions {
  url: string;
  filePath: string;
  contentType: string;
  method?: "PUT" | "POST";
  headers?: Record<string, string>;
  maxAttempts?: number;
  requestTimeoutMs?: number;
  backoffMs?: (attempt: number) => number;
  onProgress?: UploadProgress;
}

export interface RemoteUploadOptions {
  sourceUrl: string;
  destinationUrl: string;
  contentType: string;
  headers?: Record<string, string>;
  maxAttempts?: number;
  requestTimeoutMs?: number;
  backoffMs?: (attempt: number) => number;
  onProgress?: UploadProgress;
}

interface RawResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

class FatalUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalUploadError";
  }
}

function isFatalUploadError(error: unknown): error is FatalUploadError {
  return error instanceof FatalUploadError;
}

function defaultBackoff(attempt: number): number {
  const capped = Math.min(32_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  return capped + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertChunkSize(chunkSizeBytes: number): void {
  if (
    !Number.isInteger(chunkSizeBytes) ||
    chunkSizeBytes < UPLOAD_CHUNK_ALIGNMENT_BYTES ||
    chunkSizeBytes % UPLOAD_CHUNK_ALIGNMENT_BYTES !== 0 ||
    chunkSizeBytes > MAX_UPLOAD_CHUNK_BYTES
  ) {
    throw new Error(
      `Chunk size must be a multiple of 256 KiB between 256 KiB and 64 MiB (got ${chunkSizeBytes}).`
    );
  }
}

function headerValue(
  headers: http.IncomingHttpHeaders,
  name: string
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Byte offset to send next, from a 308 `Range: bytes=0-{last}` header.
 * A missing or unparseable Range means the server has nothing committed.
 */
export function nextOffsetFromRange(
  rangeHeader: string | undefined,
  total: number
): number {
  if (!rangeHeader) return 0;
  const match = /bytes=(\d+)-(\d+)/i.exec(rangeHeader);
  if (!match) return 0;
  const last = Number(match[2]);
  if (!Number.isFinite(last) || last < 0) return 0;
  return Math.min(total, last + 1);
}

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

/**
 * 301/302/307 with a Location are real redirects (S3 regional redirect).
 * 308 is YouTube's "Resume Incomplete" and must not be followed.
 */
function redirectLocation(res: RawResponse, currentUrl: string): string | null {
  if (res.statusCode !== 301 && res.statusCode !== 302 && res.statusCode !== 307) {
    return null;
  }
  const location = headerValue(res.headers, "location");
  if (!location) return null;
  return new URL(location, currentUrl).toString();
}

function requestLib(protocol: string): typeof http | typeof https {
  return protocol === "https:" ? https : http;
}

function requestUrl(
  url: string,
  method: string,
  headers: Record<string, string>,
  stream: Readable | null,
  timeoutMs: number
): Promise<RawResponse> {
  const target = new URL(url);
  const lib = requestLib(target.protocol);
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      stream?.destroy();
      reject(error);
    };
    const succeed = (value: RawResponse) => {
      if (settled) return;
      settled = true;
      // Stop sending if the server answered before the file stream finished
      // (redirect, 5xx, or a short read). A finished stream is left alone so
      // destroy() does not surface a premature-close error after success.
      if (stream && !stream.readableEnded) stream.destroy();
      resolve(value);
    };

    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          parts.push(chunk);
        });
        res.on("end", () => {
          succeed({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(parts).toString("utf8"),
          });
        });
        res.on("error", (error) => fail(error));
      }
    );

    // Inactivity timeout: a slow but moving upload is not aborted.
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Upload request timed out after ${timeoutMs}ms`));
    });
    req.on("error", (error) => fail(error instanceof Error ? error : new Error(String(error))));

    if (!stream) {
      req.end();
      return;
    }

    stream.on("error", (error) => {
      req.destroy(error);
      fail(error);
    });
    stream.pipe(req);
  });
}

function createProgressReporter(onProgress: UploadProgress | undefined, total: number) {
  let lastAt = 0;
  let lastBytes = -1;
  return async (uploaded: number) => {
    if (!onProgress) return;
    const now = Date.now();
    const finished = uploaded >= total;
    const moved = uploaded - lastBytes >= DEFAULT_UPLOAD_CHUNK_BYTES;
    if (!finished && lastBytes >= 0 && !moved && now - lastAt < 5_000) return;
    lastAt = now;
    lastBytes = uploaded;
    try {
      await onProgress(uploaded, total);
    } catch (error) {
      console.error("[bounded-upload] progress callback failed:", error);
    }
  };
}

async function queryUploadStatus(
  uploadUrl: string,
  total: number,
  timeoutMs: number,
  maxAttempts: number,
  backoffMs: (attempt: number) => number
): Promise<{ done?: RawResponse; offset: number }> {
  let attempt = 0;
  for (;;) {
    try {
      const res = await requestUrl(
        uploadUrl,
        "PUT",
        {
          "Content-Length": "0",
          "Content-Range": `bytes */${total}`,
        },
        null,
        timeoutMs
      );
      if (res.statusCode === 200 || res.statusCode === 201) {
        return { done: res, offset: total };
      }
      if (res.statusCode === 308) {
        return {
          offset: nextOffsetFromRange(headerValue(res.headers, "range"), total),
        };
      }
      if (!isRetryableStatus(res.statusCode)) {
        throw new FatalUploadError(
          `Upload status query failed (${res.statusCode}): ${res.body.slice(0, 300)}`
        );
      }
    } catch (error) {
      if (isFatalUploadError(error)) throw error;
    }
    attempt += 1;
    if (attempt >= maxAttempts) {
      throw new Error(`Upload status query failed after ${maxAttempts} attempts.`);
    }
    await sleep(backoffMs(attempt));
  }
}

/**
 * Upload a local file with YouTube's resumable protocol.
 *
 * Chunks are streamed from disk (createReadStream start/end). Only a socket
 * buffer is resident, not the file and not the bytes already sent.
 */
export async function uploadFileInChunks(
  options: ChunkedUploadOptions
): Promise<UploadHttpResult> {
  const chunkSize = options.chunkSizeBytes ?? DEFAULT_UPLOAD_CHUNK_BYTES;
  assertChunkSize(chunkSize);
  const total = statSync(options.filePath).size;
  if (total <= 0) {
    throw new Error("Refusing to upload an empty file.");
  }

  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? defaultBackoff;
  const report = createProgressReporter(options.onProgress, total);

  let offset = 0;
  let attempt = 0;

  const noteProgress = (next: number) => {
    if (next > offset) attempt = 0;
    else attempt += 1;
    offset = next;
  };

  while (offset < total) {
    if (attempt >= maxAttempts) {
      throw new Error(`Upload failed after ${maxAttempts} retries at byte ${offset}.`);
    }
    const length = Math.min(chunkSize, total - offset);
    const end = offset + length - 1;
    try {
      const stream = createReadStream(options.filePath, { start: offset, end });
      const res = await requestUrl(
        options.uploadUrl,
        "PUT",
        {
          "Content-Length": String(length),
          "Content-Type": options.contentType,
          "Content-Range": `bytes ${offset}-${end}/${total}`,
        },
        stream,
        timeoutMs
      );

      if (res.statusCode === 200 || res.statusCode === 201) {
        await report(total);
        return { statusCode: res.statusCode, body: res.body };
      }

      if (res.statusCode === 308) {
        const next = nextOffsetFromRange(headerValue(res.headers, "range"), total);
        if (next > offset) {
          noteProgress(next);
          await report(offset);
          continue;
        }
      } else if (!isRetryableStatus(res.statusCode)) {
        throw new FatalUploadError(
          `Upload failed (${res.statusCode}): ${res.body.slice(0, 500)}`
        );
      }

      const recovered = await queryUploadStatus(
        options.uploadUrl,
        total,
        timeoutMs,
        maxAttempts,
        backoffMs
      );
      if (recovered.done) {
        await report(total);
        return { statusCode: recovered.done.statusCode, body: recovered.done.body };
      }
      noteProgress(recovered.offset);
      if (attempt >= maxAttempts) {
        throw new Error(`Upload failed after ${maxAttempts} retries at byte ${offset}.`);
      }
      await sleep(backoffMs(Math.max(attempt, 1)));
      await report(offset);
    } catch (error) {
      if (isFatalUploadError(error)) throw error;
      const recovered = await queryUploadStatus(
        options.uploadUrl,
        total,
        timeoutMs,
        maxAttempts,
        backoffMs
      );
      if (recovered.done) {
        await report(total);
        return { statusCode: recovered.done.statusCode, body: recovered.done.body };
      }
      noteProgress(recovered.offset);
      if (attempt >= maxAttempts) {
        const message = error instanceof Error ? error.message : "Upload failed";
        throw new Error(`Upload failed after ${maxAttempts} retries: ${message}`);
      }
      await sleep(backoffMs(Math.max(attempt, 1)));
    }
  }

  const recovered = await queryUploadStatus(
    options.uploadUrl,
    total,
    timeoutMs,
    maxAttempts,
    backoffMs
  );
  if (recovered.done) {
    await report(total);
    return { statusCode: recovered.done.statusCode, body: recovered.done.body };
  }
  throw new Error("Upload transmitted every byte but the server did not finalize.");
}

/**
 * PUT or POST a file with a known Content-Length. The body is a file stream.
 * A 5xx or a dropped connection retries the whole PUT (S3 presigned URLs are
 * not byte-range resumable). 307 redirects are followed, which is what S3
 * does for a regional endpoint.
 */
export async function streamFilePut(
  options: StreamFilePutOptions
): Promise<UploadHttpResult> {
  const total = statSync(options.filePath).size;
  if (total < 0) {
    throw new Error("Refusing to upload a file with an unknown size.");
  }
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? defaultBackoff;
  const method = options.method ?? "PUT";
  const report = createProgressReporter(options.onProgress, total);

  let url = options.url;
  let attempt = 0;
  let redirects = 0;

  while (attempt < maxAttempts) {
    const stream = createReadStream(options.filePath);
    let sent = 0;
    stream.on("data", (chunk: Buffer) => {
      sent += chunk.length;
      void report(sent);
    });
    try {
      const res = await requestUrl(
        url,
        method,
        {
          ...options.headers,
          "Content-Type": options.contentType,
          "Content-Length": String(total),
        },
        stream,
        timeoutMs
      );
      const location = redirectLocation(res, url);
      if (location && redirects < MAX_REDIRECTS) {
        redirects += 1;
        url = location;
        continue;
      }
      if (res.statusCode >= 200 && res.statusCode < 300) {
        await report(total);
        return { statusCode: res.statusCode, body: res.body };
      }
      if (!isRetryableStatus(res.statusCode)) {
        throw new FatalUploadError(
          `Upload failed (${res.statusCode}): ${res.body.slice(0, 500)}`
        );
      }
      attempt += 1;
      if (attempt >= maxAttempts) {
        throw new Error(
          `Upload failed after ${maxAttempts} retries (last status ${res.statusCode}).`
        );
      }
      await sleep(backoffMs(attempt));
    } catch (error) {
      if (isFatalUploadError(error)) throw error;
      attempt += 1;
      if (attempt >= maxAttempts) {
        const message = error instanceof Error ? error.message : "Upload failed";
        throw new Error(`Upload failed after ${maxAttempts} retries: ${message}`);
      }
      await sleep(backoffMs(attempt));
    }
  }

  throw new Error(`Upload failed after ${maxAttempts} retries.`);
}

function contentLengthOf(headers: http.IncomingHttpHeaders): number | null {
  const raw = headerValue(headers, "content-length");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function openGet(
  url: string,
  timeoutMs: number,
  redirectsLeft = MAX_REDIRECTS
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; stream: http.IncomingMessage }> {
  const target = new URL(url);
  const lib = requestLib(target.protocol);
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: "GET",
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const location = headerValue(res.headers, "location");
        if (
          location &&
          redirectsLeft > 0 &&
          (statusCode === 301 ||
            statusCode === 302 ||
            statusCode === 303 ||
            statusCode === 307)
        ) {
          res.resume();
          const next = new URL(location, url).toString();
          openGet(next, timeoutMs, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        resolve({ statusCode, headers: res.headers, stream: res });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Download timed out after ${timeoutMs}ms`));
    });
    req.on("error", (error) => reject(error));
    req.end();
  });
}

/**
 * Copy a remote object (a GCS signed URL) to a destination PUT without
 * holding the object in a Buffer. Used for the Transistor media upload.
 * When the source omits Content-Length, the object is spilled to a temp
 * file and then streamed — still not a single in-memory buffer.
 */
export async function uploadFromRemote(
  options: RemoteUploadOptions
): Promise<UploadHttpResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? defaultBackoff;

  let destinationUrl = options.destinationUrl;
  let attempt = 0;
  let redirects = 0;

  while (attempt < maxAttempts) {
    const got = await openGet(options.sourceUrl, timeoutMs);
    if (got.statusCode < 200 || got.statusCode >= 300) {
      got.stream.resume();
      if (!isRetryableStatus(got.statusCode) && got.statusCode !== 408) {
        throw new FatalUploadError(
          `Failed to download media (${got.statusCode}).`
        );
      }
      attempt += 1;
      if (attempt >= maxAttempts) {
        throw new Error(
          `Failed to download media after ${maxAttempts} attempts (${got.statusCode}).`
        );
      }
      await sleep(backoffMs(attempt));
      continue;
    }

    const total = contentLengthOf(got.headers);
    if (total == null) {
      const dir = await mkdtemp(join(tmpdir(), "swm-upload-"));
      try {
        const filePath = join(dir, "media");
        await pipeline(got.stream, createWriteStream(filePath));
        return await streamFilePut({
          url: destinationUrl,
          filePath,
          contentType: options.contentType,
          headers: options.headers,
          maxAttempts: maxAttempts - attempt,
          requestTimeoutMs: timeoutMs,
          backoffMs,
          onProgress: options.onProgress,
        });
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }

    const report = createProgressReporter(options.onProgress, total);
    let sent = 0;
    got.stream.on("data", (chunk: Buffer) => {
      sent += chunk.length;
      void report(Math.min(sent, total));
    });

    try {
      const res = await requestUrl(
        destinationUrl,
        "PUT",
        {
          ...options.headers,
          "Content-Type": options.contentType,
          "Content-Length": String(total),
        },
        got.stream,
        timeoutMs
      );
      const location = redirectLocation(res, destinationUrl);
      if (location && redirects < MAX_REDIRECTS) {
        redirects += 1;
        destinationUrl = location;
        continue;
      }
      if (res.statusCode >= 200 && res.statusCode < 300) {
        await options.onProgress?.(total, total);
        return { statusCode: res.statusCode, body: res.body };
      }
      if (!isRetryableStatus(res.statusCode)) {
        throw new FatalUploadError(
          `Upload failed (${res.statusCode}): ${res.body.slice(0, 500)}`
        );
      }
      attempt += 1;
      if (attempt >= maxAttempts) {
        throw new Error(
          `Upload failed after ${maxAttempts} retries (last status ${res.statusCode}).`
        );
      }
      await sleep(backoffMs(attempt));
    } catch (error) {
      if (isFatalUploadError(error)) throw error;
      attempt += 1;
      if (attempt >= maxAttempts) {
        const message = error instanceof Error ? error.message : "Upload failed";
        throw new Error(`Upload failed after ${maxAttempts} retries: ${message}`);
      }
      await sleep(backoffMs(attempt));
    }
  }

  throw new Error(`Upload failed after ${maxAttempts} retries.`);
}
