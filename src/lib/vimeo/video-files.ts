/**
 * Read-only Vimeo file lookup for The OG.
 * The portal downloads a file the owner can already access. It never
 * PATCHes the video, so privacy settings Ashlea set stay as they are.
 * Tokens and download URLs are not written to logs.
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
    if (!link.startsWith("https://")) continue;
    files.push({
      link,
      quality: typeof record.quality === "string" ? record.quality : null,
      type: typeof record.type === "string" ? record.type : null,
      size: typeof record.size === "number" && record.size > 0 ? record.size : null,
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
