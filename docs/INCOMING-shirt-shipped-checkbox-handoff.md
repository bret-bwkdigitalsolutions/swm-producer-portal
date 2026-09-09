# Handoff → swm-producer-portal: "Shirt shipped" checkbox on the Subscribers page

**From:** website-stolenwatermedia session
**Date:** 2026-09-08
**Repo:** `/Users/bretkramer/Development/bwk-digital/swm-producer-portal` (branch `main`)

## Goal

Bret wants a **checkbox on the Subscribers page** to identify (and mark) who has been **shipped a shirt** — a quick inline control on the list, not buried in the detail view.

## Good news: the site-side contract already exists — no WordPress changes needed

The WordPress `swm-premium` plugin is the source of truth and already exposes everything:

- **Storage:** `wp_swm_shirt_claims.shipped_at` (datetime, nullable). `shipped_at IS NOT NULL` ⇒ shipped.
- **GET `/swm-premium/v1/portal/subscribers`** already returns per-subscriber `shirt: { choice, size, …, shipped_at }` and supports a `shirt` filter with value `shipped` / `claimed` / `unclaimed`.
- **PATCH `/swm-premium/v1/portal/subscribers/{id}`** already accepts `{ "shirt": { "shipped": true|false } }` and sets/clears `shipped_at` accordingly (preserving the original `shipped_at` when re-toggling on).
- Auth: `Authorization: Bearer <SWM_PORTAL_API_TOKEN>` (already configured in the portal).

Source: `plugins/swm-premium/includes/class-portal-api.php` (`list_subscribers`, `update_subscriber`, `apply_shirt_update`).

## What already exists in the portal (verify, then extend)

- `src/app/admin/subscribers/actions.ts:72` — **`toggleShipped` server action** already implemented (PATCH `shirt.shipped`, admin-only, returns "Marked shipped." / "Marked not shipped.").
- `src/app/admin/subscribers/display.tsx:54` — a `shipped` status entry.
- `src/app/admin/subscribers/page.tsx:236` — `<ShirtBadge status={shirtFulfillment(s.shirt)} />` on each list row (shows shipped/claimed/unclaimed as a badge).
- `src/app/admin/subscribers/subscribers-filters.tsx:36` — a "Shipped" filter option.
- `src/lib/membership/types` — `shirtFulfillment()` derives status from `shirt.shipped_at`.

So the plumbing is largely done. The likely gap is that the **list shows a read-only badge**, but there's no **inline checkbox** to toggle shipped directly from the list.

## The task (portal side)

1. On the Subscribers **list** rows, for subscribers who have **claimed** a shirt (`shirt.choice === 'accepted'`), render an inline **checkbox** bound to `shipped = shirt.shipped_at != null`.
2. On change, call the existing **`toggleShipped`** server action with the subscriber id + new value (it already PATCHes the site). Keep it admin-only (the action already enforces this).
3. Optimistic UI + revalidate the list (or rely on the action's revalidatePath). Keep the existing `ShirtBadge` or replace it with the checkbox — your call for cleanest UX; a checkbox that also reflects status is ideal.
4. Don't show the checkbox for subscribers with no shirt claim (nothing to ship).

## Acceptance

- A producer can tick "Shipped" on a subscriber row on the Subscribers page and it persists to WordPress (`shipped_at` set); unticking clears it.
- The "Shipped" filter still works and reflects the new state.
- No WordPress/site deploy required — this is portal-only.

## Coordination

- The website session owns nothing further here; the API is live on staging + prod already.
- If you find the API missing a field you need, ping the website session before adding site code — but per the above it should be complete.
