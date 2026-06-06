import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  listTransistorSubscribers,
  addTransistorSubscriber,
  removeTransistorSubscriber,
} from "@/lib/transistor-subscribers";

/**
 * Nightly cron — reconciles WordPress premium subscribers with
 * Transistor private show subscribers. Call with:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * For each premium-enabled show that has a transistorPrivateShowId:
 *   - Fetches the authoritative subscriber list from the WP REST API
 *   - Adds subscribers missing from Transistor
 *   - Removes stale Transistor subscribers not present on the website
 *
 * Processes shows sequentially to stay within Transistor's rate limit
 * (10 req / 10 s).
 */
export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    // 1. Premium shows that have a Transistor private show configured
    const shows = await prisma.showMetadata.findMany({
      where: {
        premiumEnabled: true,
        transistorPrivateShowId: { not: null },
      },
      select: {
        wpShowId: true,
        transistorPrivateShowId: true,
      },
    });

    if (shows.length === 0) {
      return NextResponse.json({ message: "No premium shows configured.", shows: [] });
    }

    // 2. Fetch authoritative subscriber list from WordPress
    //    WP_API_URL ends with /wp/v2 — strip that suffix for our custom namespace.
    const wpApiBase = (process.env.WP_API_URL ?? "").replace(/\/wp\/v2$/, "");
    const wpUser = process.env.WP_APP_USER ?? "";
    const wpPass = process.env.WP_APP_PASSWORD ?? "";
    const wpAuth = Buffer.from(`${wpUser}:${wpPass}`).toString("base64");

    const wpRes = await fetch(`${wpApiBase}/swm-premium/v1/subscribers`, {
      headers: { Authorization: `Basic ${wpAuth}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!wpRes.ok) {
      const body = await wpRes.text().catch(() => "");
      return NextResponse.json(
        { error: `WordPress API error ${wpRes.status}: ${body}` },
        { status: 502 }
      );
    }

    // Shape: { "0": ["email1", ...], "21": ["email2", ...] }
    const wpData = (await wpRes.json()) as Record<string, string[]>;
    const allAccessEmails = new Set(
      (wpData["0"] ?? []).map((e) => e.toLowerCase())
    );

    // 3. Reconcile each show sequentially
    const results = [];

    for (const show of shows) {
      const transistorShowId = show.transistorPrivateShowId as string;
      const showKey = String(show.wpShowId);

      // Build expected set: all-access + show-specific subscribers
      const showSpecific = (wpData[showKey] ?? []).map((e) => e.toLowerCase());
      const expected = new Set([...allAccessEmails, ...showSpecific]);

      // Fetch current Transistor subscribers
      const { emails: current, error: listError } = await listTransistorSubscribers(
        show.wpShowId,
        transistorShowId
      );

      if (listError) {
        results.push({
          wpShowId: show.wpShowId,
          transistorShowId,
          error: listError,
          added: 0,
          removed: 0,
          skipped: 0,
        });
        continue;
      }

      const currentSet = new Set(current);

      // Add missing
      const toAdd = [...expected].filter((e) => !currentSet.has(e));
      const toRemove = current.filter((e) => !expected.has(e));

      let added = 0;
      let addErrors = 0;

      for (const email of toAdd) {
        const { success, error } = await addTransistorSubscriber(
          show.wpShowId,
          transistorShowId,
          email
        );
        if (success) {
          added++;
        } else {
          addErrors++;
          console.error(
            `[reconcile-subscribers] Failed to add ${email} to show ${show.wpShowId}: ${error}`
          );
        }
      }

      let removed = 0;
      let removeErrors = 0;

      for (const email of toRemove) {
        const { success, error } = await removeTransistorSubscriber(
          show.wpShowId,
          transistorShowId,
          email
        );
        if (success) {
          removed++;
        } else {
          removeErrors++;
          console.error(
            `[reconcile-subscribers] Failed to remove ${email} from show ${show.wpShowId}: ${error}`
          );
        }
      }

      console.log(
        `[reconcile-subscribers] show=${show.wpShowId} expected=${expected.size} current=${currentSet.size} added=${added} removed=${removed} addErrors=${addErrors} removeErrors=${removeErrors}`
      );

      results.push({
        wpShowId: show.wpShowId,
        transistorShowId,
        expected: expected.size,
        current: currentSet.size,
        added,
        removed,
        addErrors,
        removeErrors,
      });
    }

    return NextResponse.json({
      shows: results,
      totals: {
        shows: results.length,
        added: results.reduce((s, r) => s + (r.added ?? 0), 0),
        removed: results.reduce((s, r) => s + (r.removed ?? 0), 0),
        errors: results.filter((r) => r.error || (r.addErrors ?? 0) + (r.removeErrors ?? 0) > 0)
          .length,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown reconciliation error";
    console.error("[reconcile-subscribers] Fatal:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET is exposed for ad-hoc admin debugging — same auth check.
export async function GET(request: NextRequest) {
  return POST(request);
}
