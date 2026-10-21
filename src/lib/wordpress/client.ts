import "server-only";
import {
  WpShow,
  WpTaxonomyTerm,
  WpPost,
  WpMediaUploadResponse,
  WpCreatePostPayload,
  WpApiError,
  WpConfigError,
  WordPressBlockedError,
} from "./types";
import { ContentType } from "@/lib/constants";
import { extractYoutubeVideoId } from "@/lib/youtube-url";
import { callPortalWordPress, shouldProxyWordPress } from "@/lib/wordpress/portal-proxy";
import { withRetry } from "./retry";

// Fail fast instead of hanging if the WP host is unreachable from the server
// (e.g. an egress/WAF block that only affects the Railway host, not a browser).
const WP_FETCH_TIMEOUT_MS = 15_000;

/**
 * A bot-check page is not a blip. Quick back-to-back retries hit the same
 * challenge. Wait once, then try the request a single extra time.
 */
export const WP_BLOCKED_RETRY_DELAY_MS = 5_000;

/** Decode HTML numeric & named entities that WordPress injects into rendered titles. */
export function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

const WP_API_URL = () => process.env.WP_API_URL!;

/** Basic auth for the WordPress application password. Shared with swm/v1 calls. */
export function wpAuthorizationHeader(): string {
  const user = process.env.WP_APP_USER?.trim();
  const password = process.env.WP_APP_PASSWORD?.trim();
  if (!user || !password) {
    throw new Error(
      "WordPress app credentials are not configured (set WP_APP_USER and WP_APP_PASSWORD)."
    );
  }
  return "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
}

const WP_AUTH = wpAuthorizationHeader;

// Map portal content types to WP REST API post types
// These must match the rest_base registered in WordPress
const POST_TYPE_MAP: Record<string, string> = {
  [ContentType.REVIEW]: "swm_review",
  [ContentType.TRAILER]: "swm_trailer",
  [ContentType.APPEARANCE]: "swm_appearance",
  [ContentType.EPISODE]: "swm_episode",
  [ContentType.CASE_DOCUMENT]: "swm_case_doc",
  [ContentType.SHOW]: "swm_show",
  [ContentType.REACTION]: "swm_reaction",
};

async function wpFetchOnce<T>(
  endpoint: string,
  options: RequestInit
): Promise<T> {
  const url = `${WP_API_URL()}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WP_FETCH_TIMEOUT_MS);

  let response: Response;
  let authHeader: string;
  try {
    authHeader = WP_AUTH();
  } catch (err) {
    clearTimeout(timer);
    const reason = err instanceof Error ? err.message : String(err);
    throw new WpConfigError(`WP API config error: ${reason}`, endpoint);
  }

  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: authHeader,
        ...options.headers,
      },
    });
  } catch (err) {
    // Network-level failure (DNS, connection refused/reset, TLS, or the
    // abort timeout above). Previously this propagated with no context and was
    // swallowed upstream — wrap it so the failing endpoint is identifiable.
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? `timed out after ${WP_FETCH_TIMEOUT_MS}ms`
          : err.message
        : String(err);
    throw new WpApiError(`WP API network error: ${reason}`, 0, endpoint);
  } finally {
    clearTimeout(timer);
  }

  const body = await response.text().catch(() => "");
  const contentType = response.headers?.get?.("content-type") ?? "";
  // A bot check can answer 200 or a non-2xx status with an HTML interstitial.
  // response.json() then throws "Unexpected token <", which looks like a
  // transient parse error. A 200 that starts with "<" can also be a PHP
  // notice glued in front of a successful JSON body.
  if (isHtmlBlockedBody(contentType, body)) {
    throw new WordPressBlockedError(response.status, body, endpoint);
  }

  if (!response.ok) {
    throw new WpApiError(
      `WP API error: ${response.status} — ${body.slice(0, 500)}`,
      response.status,
      endpoint
    );
  }

  return JSON.parse(body) as T;
}

function isHtmlBlockedBody(contentType: string, body: string): boolean {
  if (/html/i.test(contentType)) return true;
  const leading = body.replace(/^\uFEFF/, "").trimStart();
  return leading.startsWith("<");
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

async function wpFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const execute = () => wpFetchOnce<T>(endpoint, options);

  try {
    // Only retry idempotent reads. Writes (createPost, updatePost, media
    // attach) are not retried, including when the body is HTML. A 200 that
    // starts with "<" can be a successful write with a PHP notice in front
    // of the JSON. The processor reconciles that with findEpisodeByTitleOrSlug
    // instead of sending the write again.
    if (method !== "GET") {
      return await execute();
    }

    return await withRetry<T>(execute, {
      retries: 2,
      delayMs: 500,
      onError: (error, attempt) => {
        if (error instanceof WordPressBlockedError) return;
        const msg = error instanceof Error ? error.message : String(error);
        console.error(
          `[wp] GET ${endpoint} failed (attempt ${attempt}/3): ${msg}`
        );
      },
      // Retry only transient failures: network/timeout (status 0), rate limiting
      // (429), and server errors (5xx). A 4xx (404/401/403) is permanent.
      // Missing app credentials are a WpConfigError (also status 0) and must
      // not be retried. A bot-check page is not one of these quick retries.
      shouldRetry: (error) => {
        if (error instanceof WordPressBlockedError) return false;
        if (error instanceof WpConfigError) return false;
        if (!(error instanceof WpApiError)) return true;
        return error.status === 0 || error.status === 429 || error.status >= 500;
      },
    });
  } catch (error) {
    // One slow retry for a blocked read. Writes throw immediately: repeating
    // POST/PUT can create a second episode, and the HTML may already hide a
    // successful response.
    if (!(error instanceof WordPressBlockedError) || method !== "GET") throw error;
    console.error(
      `[wp] GET ${endpoint} returned an HTML block page (HTTP ${error.status}); retrying once in ${WP_BLOCKED_RETRY_DELAY_MS}ms`
    );
    await sleep(WP_BLOCKED_RETRY_DELAY_MS);
    return execute();
  }
}

export async function getShows(): Promise<WpShow[]> {
  const shows = await wpFetch<WpShow[]>("/swm_show?per_page=100&_fields=id,title,slug,status,meta,acf");
  for (const s of shows) s.title.rendered = decodeHtmlEntities(s.title.rendered);
  // Exclude duplicate show entries that shadow real shows. The
  // is_archive_show flag is unreliable (set on active shows too), so we
  // detect duplicates by checking for another show with the same name.
  const nameCount = new Map<string, number>();
  for (const s of shows) {
    const name = s.title.rendered.toLowerCase();
    nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  }
  return shows.filter((s) => {
    const name = s.title.rendered.toLowerCase();
    // If there's only one show with this name, keep it regardless of flags
    if ((nameCount.get(name) ?? 1) <= 1) return true;
    // Multiple shows share this name — keep the one with the lowest ID
    // (the original), drop the duplicates
    const lowestId = Math.min(
      ...shows.filter((o) => o.title.rendered.toLowerCase() === name).map((o) => o.id)
    );
    return s.id === lowestId;
  });
}

export async function getShow(id: number): Promise<WpShow> {
  if (shouldProxyWordPress()) {
    return callPortalWordPress<WpShow>({ op: "getShow", id });
  }
  const show = await wpFetch<WpShow>(`/swm_show/${id}`);
  show.title.rendered = decodeHtmlEntities(show.title.rendered);
  return show;
}

export async function getTaxonomyTerms(
  taxonomy: string
): Promise<WpTaxonomyTerm[]> {
  return wpFetch<WpTaxonomyTerm[]>(
    `/${taxonomy}?per_page=100&_fields=id,name,slug,count`
  );
}

export async function getRecentSubmissions(
  portalUserId: string,
  limit: number = 10
): Promise<WpPost[]> {
  // Query each content type in parallel, filter by portal submission meta
  const postTypes = Object.values(POST_TYPE_MAP).filter(
    (pt) => pt !== "swm_shows"
  );

  const results = await Promise.all(
    postTypes.map((postType) =>
      wpFetch<WpPost[]>(
        `/${postType}?per_page=${limit}&meta_key=_swm_portal_user_id&meta_value=${portalUserId}&_fields=id,title,status,date,link,type,meta&orderby=date&order=desc`
      ).catch(() => [] as WpPost[])
    )
  );

  const posts = results
    .flat()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);

  for (const p of posts) p.title.rendered = decodeHtmlEntities(p.title.rendered);
  return posts;
}

interface WpEpisodeSearchResult {
  id: number;
  title: { rendered: string };
  link: string;
  date: string;
  meta?: { parent_show_id?: number };
}

/**
 * Search published episodes by title fragment. Used by the pre-distribution
 * duplicate check to flag re-runs of the same content.
 */
export async function searchEpisodesByTitle(
  query: string,
  perPage: number = 10,
): Promise<WpEpisodeSearchResult[]> {
  try {
    return await wpFetch<WpEpisodeSearchResult[]>(
      `/swm_episode?per_page=${perPage}&_fields=id,title,link,date,meta&search=${encodeURIComponent(query.slice(0, 50))}&status=publish`
    );
  } catch {
    return [];
  }
}

export interface WordPressEpisodeMatch {
  id: number;
  link: string;
  slug: string;
  title: string;
}

export interface FindEpisodeOptions {
  /** Distribution job `createdAt`. A title or slug hit counts when the post is at least this new. */
  jobStartedAt?: Date | string | null;
  youtubeVideoId?: string | null;
  youtubeVideoUrl?: string | null;
}

interface WpEpisodeLookupHit {
  id: number;
  link?: string;
  slug?: string;
  date?: string;
  date_gmt?: string;
  title?: { rendered?: string };
  meta?: {
    parent_show_id?: number | string;
    youtube_video_id?: string;
    youtube_video_url?: string;
  };
}

/** WordPress `sanitize_title` approximation: lowercase, punctuation to hyphens. */
function toWordPressSlug(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

function episodeBelongsToShow(post: WpEpisodeLookupHit, wpShowId: number): boolean {
  const raw = post.meta?.parent_show_id;
  // A missing show id is not "this show". An unscoped post must not confirm a publish.
  if (raw == null || raw === "") return false;
  const id = Number(raw);
  return Number.isFinite(id) && id === wpShowId;
}

/** WordPress `date` / `date_gmt` have no zone suffix. `date_gmt` is UTC. */
function parseWordPressDate(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const parsed = new Date(hasZone ? normalized : `${normalized}Z`);
  const ms = parsed.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function jobStartMs(jobStartedAt: Date | string | null | undefined): number | null {
  if (jobStartedAt == null || jobStartedAt === "") return null;
  const parsed = jobStartedAt instanceof Date ? jobStartedAt : new Date(jobStartedAt);
  const ms = parsed.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function wantedYoutubeId(options: FindEpisodeOptions): string | null {
  const explicit = options.youtubeVideoId?.trim();
  if (explicit) return explicit;
  const url = options.youtubeVideoUrl?.trim();
  return url ? extractYoutubeVideoId(url) : null;
}

function episodeMatchesYoutube(post: WpEpisodeLookupHit, options: FindEpisodeOptions): boolean {
  const wantedId = wantedYoutubeId(options);
  const wantedUrl = options.youtubeVideoUrl?.trim() || null;
  const postId = post.meta?.youtube_video_id?.trim() || null;
  const postUrl = post.meta?.youtube_video_url?.trim() || null;
  if (wantedId && postId && postId === wantedId) return true;
  if (wantedUrl && postUrl && postUrl === wantedUrl) return true;
  if (!wantedId || !postUrl) return false;
  return extractYoutubeVideoId(postUrl) === wantedId;
}

function episodeMatchesQuery(
  post: WpEpisodeLookupHit,
  title: string,
  slug: string,
  wpShowId: number,
  options: FindEpisodeOptions
): boolean {
  if (!post.id || !episodeBelongsToShow(post, wpShowId)) return false;
  const wanted = title.trim().toLowerCase();
  const rendered = decodeHtmlEntities(post.title?.rendered ?? "")
    .trim()
    .toLowerCase();
  const titleOrSlug =
    (wanted.length > 0 && rendered === wanted) ||
    (slug.length > 0 && post.slug === slug);
  if (!titleOrSlug) return false;
  // Title and slug alone collide with older episodes. Accept the post when it
  // belongs to this upload's video, or when it was published for this job.
  if (episodeMatchesYoutube(post, options)) return true;
  const start = jobStartMs(options.jobStartedAt);
  const posted = parseWordPressDate(post.date_gmt) ?? parseWordPressDate(post.date);
  if (start == null || posted == null) return false;
  return posted >= start;
}

function toEpisodeMatch(
  post: WpEpisodeLookupHit,
  fallbackTitle: string
): WordPressEpisodeMatch {
  return {
    id: post.id,
    link: post.link ?? "",
    slug: post.slug ?? "",
    title: decodeHtmlEntities(post.title?.rendered ?? fallbackTitle),
  };
}

function serializeJobStartedAt(
  jobStartedAt: Date | string | null | undefined
): string | null {
  if (jobStartedAt == null || jobStartedAt === "") return null;
  if (jobStartedAt instanceof Date) {
    return Number.isNaN(jobStartedAt.getTime()) ? null : jobStartedAt.toISOString();
  }
  return jobStartedAt;
}

/**
 * Find an episode on this show by its title or the slug WordPress would
 * assign from that title. Drafts and scheduled posts count: a publish that
 * looked like it failed may already be stored.
 *
 * A title or slug hit is not enough. The post must be dated on or after the
 * job started, or carry this upload's YouTube id or URL. Show membership is
 * filtered here. `meta_key` / `meta_value` REST queries are not used; that
 * filter is unreliable across WordPress installs and can hide the post we
 * just created.
 */
export async function findEpisodeByTitleOrSlug(
  title: string,
  wpShowId: number,
  options: FindEpisodeOptions = {}
): Promise<WordPressEpisodeMatch | null> {
  if (shouldProxyWordPress()) {
    return callPortalWordPress<WordPressEpisodeMatch | null>({
      op: "findEpisode",
      title,
      wpShowId,
      jobStartedAt: serializeJobStartedAt(options.jobStartedAt),
      youtubeVideoId: options.youtubeVideoId?.trim() || null,
      youtubeVideoUrl: options.youtubeVideoUrl?.trim() || null,
    });
  }
  const slug = toWordPressSlug(title);
  const fields = "id,title,slug,link,date,date_gmt,meta";

  const pick = (posts: WpEpisodeLookupHit[]) =>
    posts.find((post) => episodeMatchesQuery(post, title, slug, wpShowId, options));

  if (slug) {
    const bySlug = await wpFetch<WpEpisodeLookupHit[]>(
      `/swm_episode?slug=${encodeURIComponent(slug)}&status=any&per_page=5&_fields=${fields}`
    );
    const slugMatch = Array.isArray(bySlug) ? pick(bySlug) : undefined;
    if (slugMatch) return toEpisodeMatch(slugMatch, title);
  }

  const byTitle = await wpFetch<WpEpisodeLookupHit[]>(
    `/swm_episode?search=${encodeURIComponent(title.trim().slice(0, 100))}&status=any&per_page=20&_fields=${fields}`
  );
  const titleMatch = Array.isArray(byTitle) ? pick(byTitle) : undefined;
  return titleMatch ? toEpisodeMatch(titleMatch, title) : null;
}

/**
 * Get the latest published episode for a show, returning its episode and season numbers.
 */
export async function getLatestEpisodeNumbers(
  wpShowId: number
): Promise<{ episodeNumber: number | null; seasonNumber: number | null }> {
  try {
    if (shouldProxyWordPress()) {
      return await callPortalWordPress<{
        episodeNumber: number | null;
        seasonNumber: number | null;
      }>({ op: "latestEpisodeNumbers", wpShowId });
    }
    const posts = await wpFetch<WpPost[]>(
      `/swm_episode?per_page=1&orderby=date&order=desc&status=publish&_fields=id,meta&meta_key=parent_show_id&meta_value=${wpShowId}`
    );
    if (posts.length === 0) {
      return { episodeNumber: null, seasonNumber: null };
    }
    const meta = posts[0].meta;
    const ep = Number(meta?.episode_number);
    const sn = Number(meta?.season_number);
    return {
      episodeNumber: Number.isFinite(ep) && ep > 0 ? ep : null,
      seasonNumber: Number.isFinite(sn) && sn > 0 ? sn : null,
    };
  } catch {
    return { episodeNumber: null, seasonNumber: null };
  }
}

/**
 * Get recent published episode titles for a show, used for AI title style matching.
 */
export async function getRecentEpisodeTitles(
  wpShowId: number,
  count: number = 10
): Promise<string[]> {
  try {
    if (shouldProxyWordPress()) {
      return await callPortalWordPress<string[]>({
        op: "recentEpisodeTitles",
        wpShowId,
        count,
      });
    }
    const posts = await wpFetch<WpPost[]>(
      `/swm_episode?per_page=${count}&orderby=date&order=desc&status=publish&_fields=id,title&meta_key=parent_show_id&meta_value=${wpShowId}`
    );
    return posts.map((p) => decodeHtmlEntities(p.title.rendered));
  } catch {
    return [];
  }
}

export async function uploadMedia(
  file: File,
  filename?: string
): Promise<WpMediaUploadResponse> {
  if (shouldProxyWordPress()) {
    const bytes = Buffer.from(await file.arrayBuffer());
    return callPortalWordPress<WpMediaUploadResponse>({
      op: "uploadMedia",
      filename: filename ?? file.name,
      contentType: file.type || "application/octet-stream",
      dataBase64: bytes.toString("base64"),
    });
  }
  const formData = new FormData();
  formData.append("file", file, filename ?? file.name);

  const url = `${WP_API_URL()}/media`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: WP_AUTH(),
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "Unknown error");
    throw new WpApiError(
      `Media upload failed: ${response.status} — ${body}`,
      response.status,
      "/media"
    );
  }

  return response.json();
}

/**
 * Attach media items to a post by setting their parent post ID.
 */
export async function attachMediaToPost(
  mediaIds: number[],
  postId: number
): Promise<void> {
  await Promise.all(
    mediaIds.map((mediaId) =>
      wpFetch(`/media/${mediaId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post: postId }),
      })
    )
  );
}

export async function createPost(
  contentType: string,
  payload: WpCreatePostPayload
): Promise<WpPost> {
  if (shouldProxyWordPress()) {
    return callPortalWordPress<WpPost>({ op: "createPost", contentType, payload });
  }
  const postType = POST_TYPE_MAP[contentType];
  if (!postType) {
    throw new Error(`Unknown content type: ${contentType}`);
  }

  // Stamp portal metadata
  const meta = {
    ...payload.meta,
    _swm_portal_submission: true,
  };

  // WordPress REST API requires date in YYYY-MM-DDTHH:MM:SS format.
  // datetime-local inputs only produce YYYY-MM-DDTHH:MM — append seconds if missing.
  let { date } = payload;
  if (date && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(date)) {
    date = `${date}:00`;
  }

  return wpFetch<WpPost>(`/${postType}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, meta, ...(date ? { date } : {}) }),
  });
}

export async function updatePost(
  contentType: string,
  postId: number,
  payload: Partial<WpCreatePostPayload>
): Promise<WpPost> {
  if (shouldProxyWordPress()) {
    return callPortalWordPress<WpPost>({
      op: "updatePost",
      contentType,
      postId,
      payload,
    });
  }
  const postType = POST_TYPE_MAP[contentType];
  if (!postType) {
    throw new Error(`Unknown content type: ${contentType}`);
  }

  return wpFetch<WpPost>(`/${postType}/${postId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
