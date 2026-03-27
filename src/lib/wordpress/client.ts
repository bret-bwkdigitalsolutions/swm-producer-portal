import "server-only";
import {
  WpShow,
  WpTaxonomyTerm,
  WpPost,
  WpMediaUploadResponse,
  WpCreatePostPayload,
  WpApiError,
} from "./types";
import { ContentType } from "@/lib/constants";

const WP_API_URL = () => process.env.WP_API_URL!;
const WP_AUTH = () =>
  "Basic " +
  Buffer.from(
    `${process.env.WP_APP_USER}:${process.env.WP_APP_PASSWORD}`
  ).toString("base64");

// Map portal content types to WP REST API post types
// These must match the rest_base registered in WordPress
const POST_TYPE_MAP: Record<string, string> = {
  [ContentType.REVIEW]: "swm_review",
  [ContentType.TRAILER]: "swm_trailer",
  [ContentType.APPEARANCE]: "swm_appearance",
  [ContentType.EPISODE]: "swm_episode",
  [ContentType.CASE_DOCUMENT]: "swm_case_doc",
  [ContentType.SHOW]: "swm_show",
};

async function wpFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${WP_API_URL()}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: WP_AUTH(),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "Unknown error");
    throw new WpApiError(
      `WP API error: ${response.status} — ${body}`,
      response.status,
      endpoint
    );
  }

  return response.json();
}

export async function getShows(): Promise<WpShow[]> {
  return wpFetch<WpShow[]>("/swm_show?per_page=100&_fields=id,title,slug,status,meta,acf");
}

export async function getShow(id: number): Promise<WpShow> {
  return wpFetch<WpShow>(`/swm_show/${id}`);
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

  return results
    .flat()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}

export async function uploadMedia(
  file: File,
  filename?: string
): Promise<WpMediaUploadResponse> {
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

export async function createPost(
  contentType: string,
  payload: WpCreatePostPayload
): Promise<WpPost> {
  const postType = POST_TYPE_MAP[contentType];
  if (!postType) {
    throw new Error(`Unknown content type: ${contentType}`);
  }

  // Stamp portal metadata
  const meta = {
    ...payload.meta,
    _swm_portal_submission: true,
  };

  return wpFetch<WpPost>(`/${postType}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, meta }),
  });
}

export async function updatePost(
  contentType: string,
  postId: number,
  payload: Partial<WpCreatePostPayload>
): Promise<WpPost> {
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
