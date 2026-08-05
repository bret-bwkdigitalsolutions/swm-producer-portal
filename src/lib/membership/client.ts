import "server-only";
import type {
  Subscriber,
  SubscriberListFilters,
  SubscriberListResponse,
  SubscriberPatch,
} from "./types";

// The membership base lives on the WordPress `swm-premium` plugin. We read/edit
// it live over HTTPS with a bearer token — never cached as a second source of
// truth, and every call is server-side so the token never reaches the browser.

const DEFAULT_BASE_URL =
  "https://stolenwatermedia.com/wp-json/swm-premium/v1";
const REQUEST_TIMEOUT_MS = 20_000;

function baseUrl(): string {
  return (process.env.SWM_MEMBERSHIP_API_URL ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    ""
  );
}

function token(): string | undefined {
  return process.env.SWM_MEMBERSHIP_API_TOKEN || undefined;
}

/** Whether the membership API is configured (token present). */
export function isMembershipApiConfigured(): boolean {
  return !!token();
}

export class MembershipApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly endpoint?: string
  ) {
    super(message);
    this.name = "MembershipApiError";
  }
}

/**
 * Build the query string for GET /subscribers from filters, omitting empty
 * values and clamping pagination. Pure — exported for tests.
 */
export function buildSubscribersQuery(
  filters: SubscriberListFilters = {}
): string {
  const params = new URLSearchParams();
  const { search, status, source, shirt, show_id, page, per_page } = filters;

  if (search?.trim()) params.set("search", search.trim());
  if (status) params.set("status", status);
  if (source) params.set("source", source);
  if (shirt) params.set("shirt", shirt);
  if (typeof show_id === "number" && Number.isFinite(show_id)) {
    params.set("show_id", String(show_id));
  }

  const safePage = page && page > 0 ? Math.floor(page) : 1;
  params.set("page", String(safePage));

  const safePerPage =
    per_page && per_page > 0 ? Math.min(Math.floor(per_page), 200) : 50;
  params.set("per_page", String(safePerPage));

  return params.toString();
}

async function membershipFetch<T>(
  endpoint: string,
  init: RequestInit = {}
): Promise<T> {
  const apiToken = token();
  if (!apiToken) {
    throw new MembershipApiError(
      "Membership API is not configured (SWM_MEMBERSHIP_API_TOKEN is unset).",
      undefined,
      endpoint
    );
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${endpoint}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? "timed out"
        : "could not be reached";
    throw new MembershipApiError(
      `Membership API ${reason}.`,
      undefined,
      endpoint
    );
  }

  if (!response.ok) {
    // Deliberately do not echo the response body — it may contain PII.
    throw new MembershipApiError(
      `Membership API error (${response.status}).`,
      response.status,
      endpoint
    );
  }

  return response.json() as Promise<T>;
}

export async function listSubscribers(
  filters: SubscriberListFilters = {}
): Promise<SubscriberListResponse> {
  const qs = buildSubscribersQuery(filters);
  return membershipFetch<SubscriberListResponse>(`/portal/subscribers?${qs}`);
}

export async function getSubscriber(id: number): Promise<Subscriber> {
  return membershipFetch<Subscriber>(`/portal/subscribers/${id}`);
}

export async function updateSubscriber(
  id: number,
  patch: SubscriberPatch
): Promise<Subscriber> {
  return membershipFetch<Subscriber>(`/portal/subscribers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export interface SubscriberCounts {
  total: number | null;
  active: number | null;
  migrators: number | null;
  newMembers: number | null;
  shirtsAwaiting: number | null;
}

/** Cheap total for a filtered slice (per_page=1, read `total`). */
async function countFor(
  filters: SubscriberListFilters
): Promise<number | null> {
  try {
    const res = await listSubscribers({ ...filters, page: 1, per_page: 1 });
    return res.total;
  } catch {
    return null;
  }
}

/**
 * Summary tiles. Best-effort: each count is independent, a failure yields null
 * (rendered as "—") rather than breaking the page. Migrators = Patreon +
 * Apple-legacy grants; new = Stripe-native.
 */
export async function getSubscriberCounts(): Promise<SubscriberCounts> {
  const [total, active, patreon, appleLegacy, newMembers, shirtsAwaiting] =
    await Promise.all([
      countFor({}),
      countFor({ status: "active" }),
      countFor({ source: "patreon" }),
      countFor({ source: "apple_legacy" }),
      countFor({ source: "stripe" }),
      countFor({ shirt: "claimed" }),
    ]);

  const migrators =
    patreon == null && appleLegacy == null
      ? null
      : (patreon ?? 0) + (appleLegacy ?? 0);

  return { total, active, migrators, newMembers, shirtsAwaiting };
}
