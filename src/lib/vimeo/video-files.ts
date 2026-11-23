import "server-only";

import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";

/**
 * Read-only Vimeo file lookup for The OG.
 * The portal downloads a file the owner can already access. It never
 * PATCHes the video, so privacy settings Ashlea set stay as they are.
 * Tokens and download URLs are not written to logs.
 *
 * Vimeo's API returns 302 links. Those redirects land on Vimeo's CDNs
 * (vimeocdn.com, including fpdl and skyfire, and akamaized.net, including
 * vod-progressive, vod-adaptive, download-video, and gcs-vimeo).
 */

export interface VimeoFileCandidate {
  link: string;
  quality: string | null;
  type: string | null;
  size: number | null;
  height: number | null;
  source: "download" | "files";
}

const API = "https://api.vimeo.com";

/** Two gibibytes. OG episodes are long, but a larger file is rejected. */
export const VIMEO_DOWNLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;

const MAX_REDIRECTS = 5;

/**
 * Hosts Vimeo documents for file delivery. Subdomains are included.
 * `vimeo.com` covers player.vimeo.com (the 302 the API returns).
 * `vimeocdn.com` and `akamaized.net` are the CDNs those redirects use.
 */
const VIMEO_DOWNLOAD_HOST_SUFFIXES = ["vimeo.com", "vimeocdn.com", "akamaized.net"] as const;

export function isAllowedVimeoDownloadUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host || host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return VIMEO_DOWNLOAD_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}

export function vimeoVideoPath(videoId: string, hash: string | null): string {
  if (!/^\d{1,20}$/.test(videoId)) {
    throw new Error("Vimeo video id is not numeric.");
  }
  if (hash && !/^[A-Za-z0-9]+$/.test(hash)) {
    throw new Error("Vimeo privacy hash is not valid.");
  }
  return hash ? `${videoId}:${hash}` : videoId;
}

function readFileList(value: unknown, source: "download" | "files"): VimeoFileCandidate[] {
  if (!Array.isArray(value)) return [];
  const files: VimeoFileCandidate[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const link = typeof record.link === "string" ? record.link : "";
    if (!isAllowedVimeoDownloadUrl(link)) continue;
    const size = typeof record.size === "number" && record.size > 0 ? record.size : null;
    if (size != null && size > VIMEO_DOWNLOAD_MAX_BYTES) continue;
    files.push({
      link,
      quality: typeof record.quality === "string" ? record.quality : null,
      type: typeof record.type === "string" ? record.type : null,
      size,
      height: typeof record.height === "number" && record.height > 0 ? record.height : null,
      source,
    });
  }
  return files;
}

export function parseVimeoFileCandidates(body: unknown): VimeoFileCandidate[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  return [
    ...readFileList(record.download, "download"),
    ...readFileList(record.files, "files"),
  ];
}

function isProgressiveVideo(file: VimeoFileCandidate): boolean {
  const type = (file.type ?? "").toLowerCase();
  const quality = (file.quality ?? "").toLowerCase();
  if (quality === "hls" || type.includes("mpegurl") || type.includes("dash")) return false;
  if (type.startsWith("video/")) return true;
  if (type === "application/octet-stream") return true;
  if (type === "source" || quality === "source") return true;
  return quality === "hd" || quality === "sd" || quality === "mobile";
}

/**
 * Smallest progressive file. Audio is extracted afterwards, so a smaller
 * rendition is enough and avoids pulling the source master. Owner download
 * links are preferred over player files.
 */
export function pickVimeoAudioSource(
  candidates: VimeoFileCandidate[]
): VimeoFileCandidate | null {
  const usable = candidates.filter(isProgressiveVideo);
  const downloads = usable.filter((file) => file.source === "download");
  const pool = downloads.length > 0 ? downloads : usable;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    const aSize = a.size ?? Number.POSITIVE_INFINITY;
    const bSize = b.size ?? Number.POSITIVE_INFINITY;
    if (aSize !== bSize) return aSize - bSize;
    const aHeight = a.height ?? Number.POSITIVE_INFINITY;
    const bHeight = b.height ?? Number.POSITIVE_INFINITY;
    return aHeight - bHeight;
  })[0];
}

function withoutUrls(message: string): string {
  return message.replace(/https?:\/\/\S+/g, "[url]");
}

function acceptedVideoType(header: string | null): boolean {
  const type = (header ?? "").split(";")[0].trim().toLowerCase();
  return type.startsWith("video/") || type === "application/octet-stream";
}

/**
 * Download one Vimeo file. Redirects are not followed automatically: every
 * Location is checked against the CDN allowlist. The response must be a
 * video (or octet-stream) and must stay within the size cap, both by
 * Content-Length and by bytes written. On failure the partial file is removed.
 */
export async function downloadVimeoFile(
  startUrl: string,
  destPath: string,
  options?: { timeoutMs?: number; maxBytes?: number }
): Promise<void> {
  const maxBytes = options?.maxBytes ?? VIMEO_DOWNLOAD_MAX_BYTES;
  const timeoutMs = options?.timeoutMs ?? 30 * 60 * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let current = startUrl;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isAllowedVimeoDownloadUrl(current)) {
        throw new Error("Vimeo file URL is not on an allowed host.");
      }
      let response: Response;
      try {
        response = await fetch(current, {
          redirect: "manual",
          signal: controller.signal,
        });
      } catch {
        throw new Error("Could not download the Vimeo video file.");
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new Error("Vimeo redirect had no Location.");
        current = new URL(location, current).toString();
        continue;
      }
      if (hop > MAX_REDIRECTS) break;
      if (!response.ok || !response.body) {
        throw new Error(`Vimeo file download failed (HTTP ${response.status}).`);
      }
      if (!acceptedVideoType(response.headers.get("content-type"))) {
        await response.body.cancel().catch(() => undefined);
        throw new Error("Vimeo file was not a video.");
      }
      const lengthHeader = response.headers.get("content-length");
      if (lengthHeader) {
        const length = Number(lengthHeader);
        if (!Number.isFinite(length) || length < 0 || length > maxBytes) {
          await response.body.cancel().catch(() => undefined);
          throw new Error("Vimeo file is larger than 2 GiB.");
        }
      }
      let written = 0;
      const cap = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          written += chunk.length;
          if (written > maxBytes) {
            controller.abort();
            callback(new Error("Vimeo file is larger than 2 GiB."));
            return;
          }
          callback(null, chunk);
        },
      });
      const webBody = response.body as unknown as NodeWebReadableStream<Uint8Array>;
      await pipeline(Readable.fromWeb(webBody), cap, createWriteStream(destPath));
      return;
    }
    throw new Error("Vimeo file download followed too many redirects.");
  } catch (error) {
    controller.abort();
    await rm(destPath, { force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Could not download the Vimeo video file.";
    throw new Error(withoutUrls(message));
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchVimeoFileCandidates(input: {
  videoId: string;
  hash: string | null;
  token: string;
}): Promise<VimeoFileCandidate[]> {
  const token = input.token.trim();
  if (!token) {
    throw new Error("Vimeo access token is missing.");
  }
  const endpoint = new URL(`${API}/videos/${vimeoVideoPath(input.videoId, input.hash)}`);
  endpoint.searchParams.set("fields", "download,files");

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.vimeo.*+json;version=3.4",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Could not reach the Vimeo API.");
  }
  if (!response.ok) {
    throw new Error(
      `Vimeo API returned HTTP ${response.status} for this video. The video was not modified.`
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Vimeo API did not return JSON. The video was not modified.");
  }
  return parseVimeoFileCandidates(body);
}
