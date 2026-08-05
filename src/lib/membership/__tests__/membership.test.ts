import { describe, it, expect } from "vitest";
import { buildSubscribersQuery } from "../client";
import { csvField, subscribersToCsv } from "../csv";
import { shirtFulfillment } from "../types";
import type { Subscriber, SubscriberSummary } from "../types";

describe("buildSubscribersQuery", () => {
  it("defaults to page 1 / per_page 50 with no filters", () => {
    const qs = new URLSearchParams(buildSubscribersQuery());
    expect(qs.get("page")).toBe("1");
    expect(qs.get("per_page")).toBe("50");
    expect(qs.get("search")).toBeNull();
  });

  it("includes only the filters that are set, trimming search", () => {
    const qs = new URLSearchParams(
      buildSubscribersQuery({ search: "  jane ", status: "active", shirt: "claimed" })
    );
    expect(qs.get("search")).toBe("jane");
    expect(qs.get("status")).toBe("active");
    expect(qs.get("shirt")).toBe("claimed");
    expect(qs.get("source")).toBeNull();
  });

  it("clamps per_page to 200 and floors bad pages to 1", () => {
    const qs = new URLSearchParams(
      buildSubscribersQuery({ per_page: 9999, page: -3 })
    );
    expect(qs.get("per_page")).toBe("200");
    expect(qs.get("page")).toBe("1");
  });

  it("omits a non-finite show_id", () => {
    const qs = new URLSearchParams(
      buildSubscribersQuery({ show_id: Number.NaN })
    );
    expect(qs.get("show_id")).toBeNull();
  });
});

describe("shirtFulfillment", () => {
  it("maps null/size/shipped to the right status", () => {
    expect(shirtFulfillment(null)).toBe("none");
    expect(shirtFulfillment({ size: null, shipped_at: null })).toBe("unclaimed");
    expect(shirtFulfillment({ size: "L", shipped_at: null })).toBe("awaiting");
    expect(shirtFulfillment({ size: "L", shipped_at: "2026-08-01" })).toBe(
      "shipped"
    );
  });
});

describe("csvField", () => {
  it("quotes and escapes fields with commas, quotes, or newlines", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('she said "hi"')).toBe('"she said ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField(null)).toBe("");
  });
});

describe("subscribersToCsv", () => {
  const full: Subscriber = {
    id: 1,
    email: "jane@example.com",
    display_name: "Jane, Doe",
    auth_provider: "apple",
    created_at: "2026-08-05 08:57:26",
    last_login_at: null,
    is_migrator: true,
    access: "active",
    subscription: {
      status: "active",
      tier: "premium",
      billing_period: "annual",
      current_period_end: "2027-08-05 13:57:19",
      started_at: "2026-08-05 08:57:26",
      cancelled_at: null,
      stripe_subscription_id: "sub_1",
      stripe_customer_id: "cus_1",
    },
    grant: null,
    shirt: {
      choice: "accepted",
      size: "L",
      name: "Jane Doe",
      address_line1: "1 Main St",
      address_line2: null,
      city: "Fort Worth",
      region: "TX",
      postal_code: "76102",
      country: "US",
      claimed_at: "2026-08-05",
      shipped_at: null,
    },
  };

  it("emits a header plus one row per subscriber with address for full rows", () => {
    const csv = subscribersToCsv([full]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("id,name,email,source")).toBe(true);
    // Name has a comma → must be quoted.
    expect(lines[1]).toContain('"Jane, Doe"');
    expect(lines[1]).toContain("Migrator");
    expect(lines[1]).toContain("Awaiting shipment");
    expect(lines[1]).toContain("1 Main St");
    expect(lines[1]).toContain("76102");
  });

  it("leaves address columns blank for summary-only rows", () => {
    const summary: SubscriberSummary = {
      id: 2,
      email: "new@example.com",
      display_name: "New Person",
      is_migrator: false,
      access: "active",
      subscription: {
        status: "active",
        tier: "premium",
        billing_period: "monthly",
        current_period_end: "2026-09-05",
      },
      shirt: { size: "M", shipped_at: "2026-08-02" },
    };
    const csv = subscribersToCsv([summary]);
    const row = csv.split("\r\n")[1];
    expect(row).toContain("New");
    expect(row).toContain("Shipped");
    expect(row).toContain("M");
    // No address data available on a summary → trailing empties.
    expect(row.endsWith(",,,,,,")).toBe(true);
  });
});
