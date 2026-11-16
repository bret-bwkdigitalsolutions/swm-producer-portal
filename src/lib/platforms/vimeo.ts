import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Transform } from "node:stream";

/**
 * Upload a members-only OG video to the Vimeo account that owns The OG folder.
 *
 * The token is VIMEO_OG_ACCESS_TOKEN. It is a different credential from
 * VIMEO_ACCESS_TOKEN, which is only a read token for the live-event watcher
 * and may belong to a different Vimeo user. This token must be able to upload
 * and edit videos on the account that owns folder 25496406 (user 114940578).
 *
 * Privacy is set on create, then checked again before the caller publishes:
 * hidden from vimeo.com (view=disable) and embeddable only on the allowlist.
 */

const VIMEO_API = "https://api.vimeo.com";
const VIMEO_ACCEPT = "application/vnd.vimeo.*+json;version=3.4";

export const DEFAULT_OG_EMBED_DOMAINS = [
  "stolenwatermedia.com",
  "www.stolenwatermedia.com",
  "staging.stolenwatermedia.com",
];

/** Vimeo project "The OG" on the show account. */
export const DEFAULT_OG_FOLDER_ID = "25496406";

export const OG_VIMEO_PRIVACY = {
  view: "disable",
  embed: "whitelist",
  download: false,
  add: false,
  comments: "nobody",
} as const;

export interface OgVimeoUploadParams {
  title: string;
  description: string;
  /** Local file. Required unless existingVideoId already finished uploading. */
  videoFilePath?: string;
  /** Skip creating a second video when a previous attempt already created one. */
  existingVideoId?: string;
  onVideoCreated?: (videoId: string) => Promise<void> | void;
  onProgress?: (uploaded: number, total: number) => void;
}

export interface OgVimeoUploadResult {
  videoId: string;
  mediaUrl: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
}

interface VimeoVideo {
  uri?: string;
  link?: string;
  player_embed_url?: string;
  duration?: number;
  privacy?: { view?: string; embed?: string };
  upload?: { status?: string; upload_link?: string };
  pictures?: { sizes?: Array<{ width?: number; link?: string }> };
}

export function ogEmbedDomains(envValue = process.env.VIMEO_OG_EMBED_DOMAINS): string[] {
  const raw = envValue?.trim();
  const source = raw
    ? raw.split(",")
    : DEFAULT_OG_EMBED_DOMAINS;
  const domains: string[] = [];
  for (const entry of source) {
    const domain = normalizeDomain(entry);
    if (domain && !domains.includes(domain)) domains.push(domain);
  }
  if (domains.length === 0) {
    throw new Error("VIMEO_OG_EMBED_DOMAINS did not contain a usable hostname.");
  }
  return domains;
}

export function ogFolderId(envValue = process.env.VIMEO_OG_FOLDER_ID): string | null {
  const raw = envValue?.trim();
  if (raw === "off" || raw === "none") return null;
  if (!raw) return DEFAULT_OG_FOLDER_ID;
  if (!/^\d+$/.test(raw)) {
    throw new Error("VIMEO_OG_FOLDER_ID must be a numeric Vimeo folder id.");
  }
  return raw;
}

/** Prefer the privacy-hash URL the website player already understands. */
export function ogMediaUrl(
  videoId: string,
  link?: string,
  playerEmbedUrl?: string
): string {
  const hash =
    link?.match(/vimeo\.com\/\d+\/([A-Za-z0-9]+)/)?.[1] ||
    playerEmbedUrl?.match(/[?&]h=([A-Za-z0-9]+)/)?.[1];
  if (hash) return `https://vimeo.com/${videoId}/${hash}`;
  if (link && /^https:\/\/vimeo\.com\/\d+\/?$/.test(link.split("?")[0])) {
    return link.split("?")[0].replace(/\/$/, "");
  }
  return `https://vimeo.com/${videoId}`;
}

export function scrubVimeoError(message: string): string {
  return message
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .slice(0, 500);
}

export async function uploadOgVideoToVimeo(
  params: OgVimeoUploadParams
): Promise<OgVimeoUploadResult> {
  const token = ogAccessToken();
  const existingId = params.existingVideoId?.trim();
  let videoId = existingId && /^\d+$/.test(existingId) ? existingId : "";

  if (!videoId) {
    const filePath = requiredVideoPath(params.videoFilePath);
    const size = await fileSize(filePath);
    const created = await vimeoJson<VimeoVideo>(token, "/me/videos", {
      method: "POST",
      body: JSON.stringify({
        upload: { approach: "tus", size },
        name: params.title.trim().slice(0, 128),
        description: params.description.trim().slice(0, 5000),
        privacy: OG_VIMEO_PRIVACY,
      }),
    });
    videoId = videoIdFromUri(created.uri);
    if (!videoId) {
      throw new Error("Vimeo did not return a video id.");
    }
    await params.onVideoCreated?.(videoId);
    const uploadLink = created.upload?.upload_link;
    if (!uploadLink) {
      throw new Error(`Vimeo video ${videoId} was created without an upload link.`);
    }
    await tusUpload(uploadLink, filePath, size, params.onProgress);
  } else {
    await params.onVideoCreated?.(videoId);
    await finishExistingUpload(token, videoId, params);
  }

  await vimeoJson(token, `/videos/${videoId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: params.title.trim().slice(0, 128),
      description: params.description.trim().slice(0, 5000),
      privacy: OG_VIMEO_PRIVACY,
    }),
  });

  for (const domain of ogEmbedDomains()) {
    await vimeoEmpty(token, "PUT", `/videos/${videoId}/privacy/domains/${encodeURIComponent(domain)}`);
  }

  const folderId = ogFolderId();
  if (folderId) {
    await addToOgFolder(token, videoId, folderId);
  }

  const video = await vimeoJson<VimeoVideo>(
    token,
    `/videos/${videoId}?fields=uri,link,player_embed_url,duration,privacy.view,privacy.embed,pictures.sizes`
  );
  const view = video.privacy?.view ?? "unknown";
  const embed = video.privacy?.embed ?? "unknown";
  if (view !== "disable" || embed !== "whitelist") {
    throw new Error(
      `Vimeo video ${videoId} is not hidden from Vimeo with a domain whitelist (view=${view}, embed=${embed}).`
    );
  }

  return {
    videoId,
    mediaUrl: ogMediaUrl(videoId, video.link, video.player_embed_url),
    thumbnailUrl: largestPicture(video),
    durationSeconds: typeof video.duration === "number" ? video.duration : undefined,
  };
}

function ogAccessToken(): string {
  const token = process.env.VIMEO_OG_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "VIMEO_OG_ACCESS_TOKEN is not set. OG uploads need a token for the Vimeo account that owns The OG folder."
    );
  }
  return token;
}

function requiredVideoPath(filePath: string | undefined): string {
  const path = filePath?.trim();
  if (!path) {
    throw new Error("Video file not available for the Vimeo upload.");
  }
  return path;
}

async function fileSize(filePath: string): Promise<number> {
  const info = await stat(filePath);
  if (!info.isFile() || info.size <= 0) {
    throw new Error("Video file not available for the Vimeo upload.");
  }
  return info.size;
}

async function finishExistingUpload(
  token: string,
  videoId: string,
  params: OgVimeoUploadParams
): Promise<void> {
  const current = await vimeoJson<VimeoVideo>(
    token,
    `/videos/${videoId}?fields=upload.status,link`
  );
  if (current.upload?.status === "complete") return;

  const filePath = requiredVideoPath(params.videoFilePath);
  const size = await fileSize(filePath);
  const version = await vimeoJson<VimeoVideo>(token, `/videos/${videoId}/versions`, {
    method: "POST",
    body: JSON.stringify({ upload: { approach: "tus", size } }),
  });
  const uploadLink = version.upload?.upload_link;
  if (!uploadLink) {
    throw new Error(`Vimeo video ${videoId} has no upload link to finish the file.`);
  }
  await tusUpload(uploadLink, filePath, size, params.onProgress);
}

async function tusUpload(
  uploadLink: string,
  filePath: string,
  size: number,
  onProgress?: (uploaded: number, total: number) => void
): Promise<void> {
  let uploaded = 0;
  const body = createReadStream(filePath).pipe(
    new Transform({
      transform(chunk, _encoding, callback) {
        uploaded += chunk.length;
        onProgress?.(uploaded, size);
        callback(null, chunk);
      },
    })
  );

  let response: Response;
  try {
    response = await fetch(uploadLink, {
      method: "PATCH",
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": "0",
        "Content-Type": "application/offset+octet-stream",
        "Content-Length": String(size),
      },
      body: body as unknown as BodyInit,
      duplex: "half",
    } as RequestInit);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network error";
    throw new Error(`Vimeo upload failed: ${scrubVimeoError(reason)}`);
  }

  if (!response.ok && response.status !== 204) {
    throw new Error(await vimeoErrorMessage(response));
  }
}

async function addToOgFolder(token: string, videoId: string, folderId: string): Promise<void> {
  const response = await vimeoFetch(token, "PUT", `/me/projects/${folderId}/videos/${videoId}`);
  if (response.ok || response.status === 204) return;
  // The post can still be created. The folder is organization, not the gate.
  console.warn(
    `[vimeo] Could not add video ${videoId} to folder ${folderId} (HTTP ${response.status}).`
  );
}

async function vimeoEmpty(token: string, method: string, path: string): Promise<void> {
  const response = await vimeoFetch(token, method, path);
  if (!response.ok && response.status !== 204) {
    throw new Error(await vimeoErrorMessage(response));
  }
}

async function vimeoJson<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await vimeoFetch(token, init.method ?? "GET", path, {
    ...init,
    headers,
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(await vimeoErrorMessage(response));
  }
  if (response.status === 204) return {} as T;
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Vimeo returned a non-JSON response (HTTP ${response.status}).`);
  }
}

async function vimeoFetch(
  token: string,
  method: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", VIMEO_ACCEPT);
  const url = path.startsWith("http") ? path : `${VIMEO_API}${path}`;
  try {
    return await fetch(url, { ...init, method, headers });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network error";
    throw new Error(`Vimeo request failed: ${scrubVimeoError(reason)}`);
  }
}

async function vimeoErrorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as {
      error?: string;
      developer_message?: string;
    };
    detail = parsed.developer_message || parsed.error || detail;
  } catch {
    // Keep the sliced body.
  }
  return scrubVimeoError(`Vimeo API ${response.status}: ${detail}`);
}

function videoIdFromUri(uri: string | undefined): string {
  const match = uri?.match(/\/videos\/(\d+)/);
  return match?.[1] ?? "";
}

function largestPicture(video: VimeoVideo): string | undefined {
  let best: { width: number; link: string } | undefined;
  for (const size of video.pictures?.sizes ?? []) {
    if (!size.link) continue;
    const width = size.width ?? 0;
    if (!best || width > best.width) best = { width, link: size.link };
  }
  return best?.link;
}

function normalizeDomain(value: string): string {
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (!domain || !/^[a-z0-9.-]+$/.test(domain) || domain.includes("..")) return "";
  return domain;
}
