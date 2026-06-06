import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  addTransistorSubscriber,
  removeTransistorSubscriber,
} from "@/lib/transistor-subscribers";

/**
 * POST /api/webhooks/subscription
 *
 * Receives subscription lifecycle events from the WordPress site and syncs
 * subscribers to Transistor private shows.
 *
 * Headers:
 *   Authorization: Bearer <SUBSCRIPTION_WEBHOOK_SECRET>
 *
 * Body:
 *   {
 *     event:    "subscription.created" | "subscription.cancelled" | "subscription.expired"
 *     email:    string
 *     wpShowId: number   — 0 for all_access, specific show ID for per-show access
 *     scope:    "all_access" | "show"
 *     status:   string   — Stripe subscription status (informational)
 *   }
 */

type SubscriptionEvent =
  | "subscription.created"
  | "subscription.cancelled"
  | "subscription.expired";

interface WebhookBody {
  event: SubscriptionEvent;
  email: string;
  wpShowId: number;
  scope: "all_access" | "show";
  status: string;
}

interface SyncResult {
  wpShowId: number;
  transistorShowId: string;
  success: boolean;
  error?: string;
}

const VALID_EVENTS: SubscriptionEvent[] = [
  "subscription.created",
  "subscription.cancelled",
  "subscription.expired",
];

export async function POST(request: NextRequest) {
  // Validate auth
  const secret = process.env.SUBSCRIPTION_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "[api/webhooks/subscription] SUBSCRIPTION_WEBHOOK_SECRET is not configured."
    );
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body
  const body = await request.json().catch(() => null) as WebhookBody | null;
  if (
    !body ||
    typeof body.event !== "string" ||
    typeof body.email !== "string" ||
    typeof body.wpShowId !== "number" ||
    typeof body.scope !== "string"
  ) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { event, email, wpShowId, scope } = body;

  if (!VALID_EVENTS.includes(event)) {
    return NextResponse.json(
      { error: `Unknown event: ${event}` },
      { status: 400 }
    );
  }

  console.log(
    `[api/webhooks/subscription] ${event} for ${email}, scope=${scope}, wpShowId=${wpShowId}`
  );

  // Resolve which shows to sync
  let shows: { wpShowId: number; transistorPrivateShowId: string }[];

  if (scope === "all_access") {
    // Affect all premium-enabled shows with a private Transistor show configured
    const rows = await db.showMetadata.findMany({
      where: {
        premiumEnabled: true,
        transistorPrivateShowId: { not: null },
      },
      select: {
        wpShowId: true,
        transistorPrivateShowId: true,
      },
    });
    shows = rows
      .filter((r) => r.transistorPrivateShowId != null)
      .map((r) => ({
        wpShowId: r.wpShowId,
        transistorPrivateShowId: r.transistorPrivateShowId!,
      }));
  } else {
    // scope === "show" — look up this specific show
    const row = await db.showMetadata.findUnique({
      where: { wpShowId },
      select: {
        wpShowId: true,
        transistorPrivateShowId: true,
        premiumEnabled: true,
      },
    });

    if (!row || !row.premiumEnabled || !row.transistorPrivateShowId) {
      return NextResponse.json(
        { error: `Show ${wpShowId} is not premium-enabled or has no private Transistor show` },
        { status: 422 }
      );
    }

    shows = [
      {
        wpShowId: row.wpShowId,
        transistorPrivateShowId: row.transistorPrivateShowId,
      },
    ];
  }

  if (shows.length === 0) {
    return NextResponse.json({
      message: "No eligible shows to sync",
      results: [],
    });
  }

  // Execute sync for each show
  const isAdd = event === "subscription.created";
  const syncFn = isAdd ? addTransistorSubscriber : removeTransistorSubscriber;

  const results: SyncResult[] = await Promise.all(
    shows.map(async ({ wpShowId: showWpId, transistorPrivateShowId }) => {
      const result = await syncFn(showWpId, transistorPrivateShowId, email);
      return {
        wpShowId: showWpId,
        transistorShowId: transistorPrivateShowId,
        ...result,
      };
    })
  );

  const failures = results.filter((r) => !r.success);

  if (failures.length > 0) {
    console.error(
      `[api/webhooks/subscription] ${failures.length} sync failure(s) for ${email}:`,
      failures
    );
  }

  return NextResponse.json(
    {
      message: `Processed ${event} for ${email}`,
      synced: results.length,
      failures: failures.length,
      results,
    },
    { status: failures.length > 0 ? 207 : 200 }
  );
}
