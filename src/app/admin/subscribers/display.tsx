import { Badge } from "@/components/ui/badge";
import type {
  AccessState,
  ShirtFulfillment,
  SubscriptionStatus,
} from "@/lib/membership/types";

export function AccessBadge({ access }: { access: AccessState }) {
  const map: Record<AccessState, { label: string; className: string }> = {
    active: {
      label: "Active",
      className:
        "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
    },
    grace: {
      label: "Grace",
      className:
        "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
    },
    none: {
      label: "No access",
      className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
    },
  };
  const { label, className } = map[access];
  return <Badge className={className}>{label}</Badge>;
}

const SUB_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  cancelled: "Cancelled",
};

export function subscriptionStatusLabel(
  status: SubscriptionStatus | undefined | null
): string {
  return status ? SUB_STATUS_LABEL[status] : "—";
}

export function ShirtBadge({ status }: { status: ShirtFulfillment }) {
  const map: Record<ShirtFulfillment, { label: string; className: string }> = {
    none: { label: "—", className: "bg-transparent text-muted-foreground" },
    unclaimed: {
      label: "Unclaimed",
      className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
    },
    awaiting: {
      label: "Awaiting shipment",
      className:
        "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
    },
    shipped: {
      label: "Shipped",
      className:
        "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
    },
  };
  const { label, className } = map[status];
  return <Badge className={className}>{label}</Badge>;
}

export function planLabel(
  sub: { tier: string; billing_period: string } | null | undefined
): string {
  if (!sub) return "—";
  const period = sub.billing_period === "annual" ? "Annual" : "Monthly";
  const tier = sub.tier
    ? sub.tier.charAt(0).toUpperCase() + sub.tier.slice(1)
    : "";
  return tier ? `${tier} · ${period}` : period;
}

/** Format an ISO/SQL datetime string as a short date, or "—". */
export function shortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
