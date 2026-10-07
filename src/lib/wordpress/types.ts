export interface WpShow {
  id: number;
  title: { rendered: string };
  slug: string;
  status: string;
  meta: Record<string, unknown>;
  acf?: Record<string, unknown>;
}

export interface WpTaxonomyTerm {
  id: number;
  name: string;
  slug: string;
  count: number;
}

export interface WpPost {
  id: number;
  title: { rendered: string };
  status: string;
  date: string;
  link: string;
  type: string;
  meta: Record<string, unknown>;
}

export interface WpMediaUploadResponse {
  id: number;
  source_url: string;
  title: { rendered: string };
}

export interface WpCreatePostPayload {
  title: string;
  status: "publish" | "future" | "draft";
  date?: string;
  content?: string;
  featured_media?: number;
  meta?: Record<string, unknown>;
  [key: string]: unknown; // ACF fields, taxonomies, etc.
}

export class WpApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string
  ) {
    super(message);
    this.name = "WpApiError";
  }
}

/** Missing WordPress app credentials. Status is 0, and this must not be retried. */
export class WpConfigError extends WpApiError {
  constructor(message: string, endpoint: string) {
    super(message, 0, endpoint);
    this.name = "WpConfigError";
  }
}
