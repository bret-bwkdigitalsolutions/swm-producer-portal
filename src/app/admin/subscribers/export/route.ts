import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  isMembershipApiConfigured,
  listSubscribers,
  getSubscriber,
} from "@/lib/membership/client";
import { subscribersToCsv } from "@/lib/membership/csv";
import type {
  Subscriber,
  SubscriberListFilters,
  SubscriberSummary,
} from "@/lib/membership/types";

// Safety cap so a mis-filtered export can't page/hydrate unbounded.
const MAX_ROWS = 5000;
const HYDRATE_CONCURRENCY = 6;

function parseFilters(sp: URLSearchParams): SubscriberListFilters {
  const num = (v: string | null) => (v ? parseInt(v, 10) : undefined);
  return {
    search: sp.get("search") ?? undefined,
    status: (sp.get("status") as SubscriberListFilters["status"]) ?? undefined,
    source: (sp.get("source") as SubscriberListFilters["source"]) ?? undefined,
    shirt: (sp.get("shirt") as SubscriberListFilters["shirt"]) ?? undefined,
    show_id: num(sp.get("show_id")),
  };
}

/** Hydrate summaries to full subscribers (for addresses), bounded concurrency. */
async function hydrate(
  summaries: SubscriberSummary[]
): Promise<(Subscriber | SubscriberSummary)[]> {
  const out: (Subscriber | SubscriberSummary)[] = new Array(summaries.length);
  let cursor = 0;
  async function worker() {
    while (cursor < summaries.length) {
      const i = cursor++;
      try {
        out[i] = await getSubscriber(summaries[i].id);
      } catch {
        // Fall back to the summary (address columns blank) rather than failing
        // the whole export for one bad row.
        out[i] = summaries[i];
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(HYDRATE_CONCURRENCY, summaries.length) }, worker)
  );
  return out;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isMembershipApiConfigured()) {
    return NextResponse.json(
      { error: "Membership API not configured" },
      { status: 503 }
    );
  }

  const filters = parseFilters(request.nextUrl.searchParams);

  // Page through the full filtered set.
  const summaries: SubscriberSummary[] = [];
  let page = 1;
  try {
    for (;;) {
      const res = await listSubscribers({ ...filters, page, per_page: 200 });
      summaries.push(...res.subscribers);
      if (
        res.subscribers.length === 0 ||
        summaries.length >= res.total ||
        summaries.length >= MAX_ROWS
      ) {
        break;
      }
      page++;
    }
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch subscribers from the membership API." },
      { status: 502 }
    );
  }

  const rows = await hydrate(summaries.slice(0, MAX_ROWS));
  const csv = subscribersToCsv(rows);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="swm-subscribers.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
