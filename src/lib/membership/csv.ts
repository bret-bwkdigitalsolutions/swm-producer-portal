import type { Subscriber, SubscriberSummary } from "./types";
import { shirtFulfillment } from "./types";

/** RFC-4180 field escaping: quote when the value contains comma, quote, or newline. */
export function csvField(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsvRow(fields: unknown[]): string {
  return fields.map(csvField).join(",");
}

const SHIRT_STATUS_LABEL: Record<string, string> = {
  none: "No shirt",
  unclaimed: "Unclaimed",
  awaiting: "Awaiting shipment",
  shipped: "Shipped",
};

/**
 * Fulfillment-oriented CSV of subscribers. Optimized for a shirt shipping run:
 * name, size, full address, plus subscription context. Accepts full Subscriber
 * rows (with address) or summaries (address columns come out blank).
 */
export function subscribersToCsv(
  rows: (Subscriber | SubscriberSummary)[]
): string {
  const header = [
    "id",
    "name",
    "email",
    "source",
    "access",
    "subscription_status",
    "tier",
    "billing_period",
    "renews",
    "shirt_status",
    "shirt_size",
    "ship_name",
    "address_line1",
    "address_line2",
    "city",
    "region",
    "postal_code",
    "country",
  ];

  const lines = [toCsvRow(header)];

  for (const r of rows) {
    const full = "grant" in r ? (r as Subscriber) : null;
    const shirt = r.shirt ?? null;
    const fullShirt = full?.shirt ?? null;
    lines.push(
      toCsvRow([
        r.id,
        r.display_name ?? "",
        r.email,
        r.is_migrator ? "Migrator" : "New",
        r.access,
        r.subscription?.status ?? "",
        r.subscription?.tier ?? "",
        r.subscription?.billing_period ?? "",
        r.subscription?.current_period_end ?? "",
        SHIRT_STATUS_LABEL[shirtFulfillment(shirt)],
        shirt?.size ?? "",
        fullShirt?.name ?? "",
        fullShirt?.address_line1 ?? "",
        fullShirt?.address_line2 ?? "",
        fullShirt?.city ?? "",
        fullShirt?.region ?? "",
        fullShirt?.postal_code ?? "",
        fullShirt?.country ?? "",
      ])
    );
  }

  return lines.join("\r\n");
}
