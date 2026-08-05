// Types for the Stolen Water Media membership base, served by the WordPress
// `swm-premium` REST API (source of truth). The portal reads/edits live — it
// must never treat this data as a second source of truth. See
// src/lib/membership/client.ts for the transport.

export type AccessState = "active" | "grace" | "none";
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "cancelled";
export type MembershipSource = "stripe" | "patreon" | "apple_legacy";
export type AuthProvider = "apple" | "google" | "password" | "magic_link";
export type ShirtSize = "XS" | "S" | "M" | "L" | "XL" | "2XL" | "3XL";

export const SHIRT_SIZES: ShirtSize[] = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
];

export interface Subscription {
  status: SubscriptionStatus;
  tier: string;
  billing_period: "monthly" | "annual";
  current_period_end: string | null;
  started_at: string | null;
  cancelled_at: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
}

export interface Grant {
  source: Exclude<MembershipSource, "stripe">;
  valid_until: string | null;
  migrated_to_stripe_at: string | null;
  patreon_since: string | null;
  patreon_tier: string | null;
}

export interface Shirt {
  choice: "accepted" | "declined";
  size: ShirtSize | null;
  name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  claimed_at: string | null;
  shipped_at: string | null;
}

export interface Subscriber {
  id: number;
  email: string;
  display_name: string | null;
  auth_provider: AuthProvider;
  created_at: string;
  last_login_at: string | null;
  is_migrator: boolean;
  access: AccessState;
  subscription: Subscription | null;
  grant: Grant | null;
  shirt: Shirt | null;
}

/** Table-row shape: the full object minus verbose address lines. */
export interface SubscriberSummary {
  id: number;
  email: string;
  display_name: string | null;
  is_migrator: boolean;
  access: AccessState;
  subscription: Pick<
    Subscription,
    "status" | "tier" | "billing_period" | "current_period_end"
  > | null;
  shirt: Pick<Shirt, "size" | "shipped_at"> | null;
}

export type ShirtStatusFilter = "unclaimed" | "claimed" | "shipped";

/** Query params accepted by GET /subscribers. All optional. */
export interface SubscriberListFilters {
  search?: string;
  status?: SubscriptionStatus | "grace" | "none";
  source?: MembershipSource;
  shirt?: ShirtStatusFilter;
  show_id?: number;
  page?: number;
  per_page?: number;
}

export interface SubscriberListResponse {
  total: number;
  page: number;
  per_page: number;
  subscribers: SubscriberSummary[];
}

/** Editable fields for PATCH /subscribers/{id}. */
export interface SubscriberPatch {
  display_name?: string;
  shirt?: {
    size?: ShirtSize;
    name?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country?: string;
    shipped?: boolean;
  };
}

/** Derived fulfillment status for a subscriber's shirt, for display/filtering. */
export type ShirtFulfillment = "none" | "unclaimed" | "awaiting" | "shipped";

export function shirtFulfillment(
  shirt: Pick<Shirt, "size" | "shipped_at"> | null | undefined
): ShirtFulfillment {
  if (!shirt) return "none";
  if (shirt.shipped_at) return "shipped";
  if (shirt.size) return "awaiting";
  return "unclaimed";
}
