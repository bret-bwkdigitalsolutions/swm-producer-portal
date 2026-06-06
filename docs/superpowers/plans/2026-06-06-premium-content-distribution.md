# Premium Content Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable producers to distribute premium (gated) content across WordPress, Transistor, and YouTube, with real-time subscriber sync from the website to Transistor private shows.

**Architecture:** The portal gets an `isPremium` flag on distribution jobs that routes content to gated destinations — unlisted on YouTube, private Transistor show, and `is_premium_only` meta on WordPress. A webhook from the website's Stripe integration notifies the portal of subscriber changes, which the portal forwards to Transistor's subscriber API. A nightly reconciliation cron catches any missed events.

**Tech Stack:** Next.js 16 (App Router), Prisma 7, Transistor API v1, WordPress REST API, PHP (WordPress plugin)

**Repos:** swm-producer-portal (primary), website-stolenwatermedia (WordPress plugin changes)

---

## File Structure

### Portal (swm-producer-portal)

| File | Action | Responsibility |
|------|--------|---------------|
| `prisma/schema.prisma` | Modify | Add `isPremium` to DistributionJob, `premiumEnabled`/`transistorPrivateShowId` to ShowMetadata |
| `prisma/migrations/YYYYMMDD_add_premium_fields/migration.sql` | Create | Migration for new fields |
| `src/app/admin/shows/actions.ts` | Modify | Add `updateShowPremium` server action |
| `src/app/admin/shows/show-premium-editor.tsx` | Create | Premium config UI (toggle + Transistor ID) |
| `src/app/admin/shows/page.tsx` | Modify | Render `ShowPremiumEditor` |
| `src/app/dashboard/distribute/new/distribution-form.tsx` | Modify | Add premium toggle |
| `src/app/dashboard/distribute/new/actions.ts` | Modify | Pass `isPremium` to job creation |
| `src/app/dashboard/distribute/[id]/job-detail-view.tsx` | Modify | Show YouTube Studio reminder for premium jobs |
| `src/lib/jobs/processor.ts` | Modify | Route premium jobs to private Transistor show, set WP meta, default YouTube to unlisted |
| `src/lib/platforms/wordpress.ts` | Modify | Accept and pass `isPremiumOnly` meta |
| `src/lib/platforms/transistor.ts` | Modify | Accept optional `transistorShowIdOverride` |
| `src/lib/live-recording/handoff.ts` | Modify | Thread `isPremiumOnly` to distribution job |
| `src/lib/jobs/verify-distribution.ts` | Modify | Skip YouTube public URL check for premium |
| `src/app/api/webhooks/subscription/route.ts` | Create | Receive subscription events from website |
| `src/lib/transistor-subscribers.ts` | Create | Transistor subscriber API client |
| `src/app/api/cron/reconcile-subscribers/route.ts` | Create | Nightly subscriber reconciliation |

### Website (website-stolenwatermedia)

| File | Action | Responsibility |
|------|--------|---------------|
| `plugins/swm-premium/includes/class-stripe.php` | Modify | Fire webhook to portal on subscription events |
| `plugins/swm-premium/includes/class-rest-api.php` | Create | REST endpoint for subscriber list |
| `plugins/swm-premium/swm-premium.php` | Modify | Include new REST API class |

---

## Task 1: Prisma Migration — Add Premium Fields

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/YYYYMMDD_add_premium_fields/migration.sql`

- [ ] **Step 1: Add fields to schema.prisma**

In the `DistributionJob` model, add after the `errorMessage` field:

```prisma
  isPremium         Boolean   @default(false)
```

In the `ShowMetadata` model, add after the `currentSeason` field:

```prisma
  premiumEnabled          Boolean  @default(false)
  transistorPrivateShowId String?
```

- [ ] **Step 2: Generate and run migration**

```bash
npx prisma migrate dev --name add_premium_fields
```

Expected: Migration creates successfully, adds three columns with defaults.

- [ ] **Step 3: Verify schema**

```bash
npx prisma studio
```

Check that `DistributionJob` has `isPremium` (Boolean, default false) and `ShowMetadata` has `premiumEnabled` (Boolean, default false) and `transistorPrivateShowId` (String, nullable).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add premium content fields to DistributionJob and ShowMetadata"
```

---

## Task 2: Admin UI — Show Premium Editor

**Files:**
- Create: `src/app/admin/shows/show-premium-editor.tsx`
- Modify: `src/app/admin/shows/actions.ts`
- Modify: `src/app/admin/shows/page.tsx`

- [ ] **Step 1: Add server action for premium settings**

In `src/app/admin/shows/actions.ts`, add the `updateShowPremium` action. Follow the pattern of the existing `updateShowHosts` action (lines 135-164):

```typescript
export async function updateShowPremium(
  prevState: { success?: boolean; error?: string },
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  await requireAdmin();
  const wpShowId = Number(formData.get("wpShowId"));
  if (!wpShowId) return { error: "Missing show ID" };

  const premiumEnabled = formData.get("premiumEnabled") === "true";
  const transistorPrivateShowId = formData.get("transistorPrivateShowId")?.toString().trim() || null;

  if (premiumEnabled && !transistorPrivateShowId) {
    return { error: "Transistor Private Show ID is required when premium is enabled" };
  }

  await db.showMetadata.upsert({
    where: { wpShowId },
    create: { wpShowId, hosts: "", premiumEnabled, transistorPrivateShowId },
    update: { premiumEnabled, transistorPrivateShowId },
  });

  return { success: true };
}
```

- [ ] **Step 2: Create the premium editor component**

Create `src/app/admin/shows/show-premium-editor.tsx`. Model after `show-hosts-editor.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { updateShowPremium } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";

interface Props {
  wpShowId: number;
  premiumEnabled: boolean;
  transistorPrivateShowId: string | null;
}

export function ShowPremiumEditor({ wpShowId, premiumEnabled, transistorPrivateShowId }: Props) {
  const [state, action, pending] = useActionState(updateShowPremium, {});
  const [enabled, setEnabled] = useState(premiumEnabled);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="wpShowId" value={wpShowId} />
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`premium-${wpShowId}`}
          name="premiumEnabled"
          value="true"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded border-gray-300"
        />
        <Label htmlFor={`premium-${wpShowId}`} className="cursor-pointer text-sm">
          Premium content enabled
        </Label>
      </div>
      {enabled && (
        <div className="space-y-1">
          <Label htmlFor={`transistor-private-${wpShowId}`} className="text-sm">
            Transistor Private Show ID
          </Label>
          <Input
            id={`transistor-private-${wpShowId}`}
            name="transistorPrivateShowId"
            defaultValue={transistorPrivateShowId ?? ""}
            placeholder="e.g. 12345"
            className="max-w-xs"
          />
        </div>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
      {state.success && <p className="text-sm text-green-600">Saved</p>}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Add to show admin page**

In `src/app/admin/shows/page.tsx`, find where `ShowHostsEditor` is rendered for each show. Add `ShowPremiumEditor` below it. The page already queries `ShowMetadata` — add the new fields to the select:

Find the `showMetadata` query and add `premiumEnabled` and `transistorPrivateShowId` to its select/include. Then render:

```tsx
<ShowPremiumEditor
  wpShowId={show.wpShowId}
  premiumEnabled={meta?.premiumEnabled ?? false}
  transistorPrivateShowId={meta?.transistorPrivateShowId ?? null}
/>
```

- [ ] **Step 4: Verify in browser**

Navigate to `/admin/shows`. Confirm:
- Premium toggle appears for each show
- Toggling on reveals the Transistor Private Show ID input
- Saving persists the values
- Saving with premium enabled but no Transistor ID shows an error

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/shows/
git commit -m "feat: add premium content settings to show admin"
```

---

## Task 3: Distribution Form — Premium Toggle

**Files:**
- Modify: `src/app/dashboard/distribute/new/distribution-form.tsx`
- Modify: `src/app/dashboard/distribute/new/actions.ts`

- [ ] **Step 1: Pass premium-enabled shows to the form**

In the page that renders the distribution form, the show list is already passed as props. The form needs to know which shows have `premiumEnabled: true`. Modify the show data query to include `premiumEnabled` from `ShowMetadata`, and pass it down so the form knows which shows support premium.

In the form's show type/interface, add:

```typescript
premiumEnabled?: boolean;
```

- [ ] **Step 2: Add premium toggle to the form**

In `distribution-form.tsx`, add a premium toggle near the explicit content checkbox (around line 1199). It should only render when the selected show has `premiumEnabled: true`:

```tsx
{selectedShow?.premiumEnabled && (
  <div className="flex items-center gap-2">
    <input
      type="checkbox"
      id="isPremium"
      name="isPremium"
      value="true"
      onChange={(e) => {
        // When premium is toggled on, default YouTube privacy to unlisted
        if (e.target.checked) {
          setYoutubePrivacy("unlisted");
        }
      }}
      className="rounded border-gray-300"
    />
    <Label htmlFor="isPremium" className="cursor-pointer text-sm">
      Premium content (gated for subscribers only)
    </Label>
  </div>
)}
```

- [ ] **Step 3: Thread premium flag through actions**

In `src/app/dashboard/distribute/new/actions.ts`, in both `submitDistribution` and `updateDistribution`:

Extract the flag:
```typescript
const isPremium = formData.get("isPremium") === "true";
```

Add to the metadata object:
```typescript
metadata = {
  ...existingMetadata,
  youtubePrivacy: isPremium ? "unlisted" : (isDraft ? "unlisted" : "public"),
  // ... other fields
};
```

Set on the job creation:
```typescript
await db.distributionJob.create({
  data: {
    // ... existing fields
    isPremium,
    // ...
  },
});
```

- [ ] **Step 4: Verify in browser**

1. Select a show without premium enabled — no toggle visible
2. Select a show with premium enabled — toggle appears
3. Toggle premium on — YouTube privacy switches to unlisted
4. Submit a test distribution — confirm `isPremium: true` in the database

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/distribute/new/
git commit -m "feat: add premium content toggle to distribution form"
```

---

## Task 4: WordPress Publishing — Premium Meta

**Files:**
- Modify: `src/lib/platforms/wordpress.ts`

- [ ] **Step 1: Add isPremiumOnly to the interface**

In `src/lib/platforms/wordpress.ts`, add to the `WordPressPublishParams` interface (around line 30):

```typescript
isPremiumOnly?: boolean;
```

- [ ] **Step 2: Pass the meta field**

In the `publishToWordPress` function, add to the `meta` object (around line 91):

```typescript
meta: {
  // ... existing fields
  ...(isPremiumOnly ? { is_premium_only: true } : {}),
},
```

Destructure from params at the top of the function:

```typescript
const { wpShowId, title, description, /* ... existing */, isPremiumOnly } = params;
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/platforms/wordpress.ts
git commit -m "feat: pass is_premium_only meta to WordPress for premium episodes"
```

---

## Task 5: Transistor Upload — Show ID Override

**Files:**
- Modify: `src/lib/platforms/transistor.ts`

- [ ] **Step 1: Add override param to the interface**

In `src/lib/platforms/transistor.ts`, add to `TransistorUploadParams` (around line 55):

```typescript
transistorShowIdOverride?: string;
```

- [ ] **Step 2: Use override in upload function**

In the `uploadToTransistor` function, after the existing show ID resolution (around line 103), add a conditional override:

Find the line where `transistorShowId` is resolved (something like `const transistorShowId = ...`) and add after it:

```typescript
// Override with private show ID for premium content
if (params.transistorShowIdOverride) {
  transistorShowId = params.transistorShowIdOverride;
}
```

Note: `transistorShowId` may need to change from `const` to `let` for this override to work.

- [ ] **Step 3: Commit**

```bash
git add src/lib/platforms/transistor.ts
git commit -m "feat: support Transistor show ID override for premium private shows"
```

---

## Task 6: Processor — Premium Routing

**Files:**
- Modify: `src/lib/jobs/processor.ts`

- [ ] **Step 1: Read premium flag and show metadata**

The processor already loads `showMetadata` early on. Ensure `premiumEnabled` and `transistorPrivateShowId` are available. Near the top where `showMeta` is loaded (around line 168), the query already fetches the full model, so the new fields are automatically included.

Read the premium flag from the job:

```typescript
const isPremium = job.isPremium;
```

- [ ] **Step 2: Modify YouTube phase**

In the YouTube upload section (around line 460), when determining privacy:

```typescript
const youtubePrivacy = isPremium
  ? "unlisted"
  : (updatedMetadata.youtubePrivacy as string) ?? (isDraft ? "unlisted" : "public");
```

- [ ] **Step 3: Modify Transistor phase**

In the Transistor upload section (around line 523), add the show ID override when premium:

```typescript
const result = await uploadToTransistor({
  // ... existing params
  transistorShowIdOverride: isPremium ? showMeta?.transistorPrivateShowId ?? undefined : undefined,
});
```

Add a guard before the upload — if premium but no private show configured, fail with a clear message:

```typescript
if (isPremium && !showMeta?.transistorPrivateShowId) {
  throw new Error(
    "Premium distribution requires a Transistor Private Show ID. Configure it in Admin > Shows."
  );
}
```

Also handle the network cross-post section (around line 555): skip network cross-posting for premium episodes since the premium content should only go to the show-specific private feed:

```typescript
if (!isPremium) {
  // existing network cross-post logic
}
```

- [ ] **Step 4: Modify WordPress phase**

In the WordPress publishing section (around line 648), pass the premium flag:

```typescript
const result = await publishToWordPress({
  // ... existing params
  isPremiumOnly: isPremium,
});
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/processor.ts
git commit -m "feat: route premium distributions to private Transistor show, unlisted YouTube, and gated WordPress"
```

---

## Task 7: Live Recording Handoff — Thread Premium Flag

**Files:**
- Modify: `src/lib/live-recording/handoff.ts`

- [ ] **Step 1: Pass isPremiumOnly to distribution job creation**

In `src/lib/live-recording/handoff.ts`, find where the `DistributionJob` is created (around lines 83-102). Add the premium flag:

```typescript
const job = await db.distributionJob.create({
  data: {
    // ... existing fields
    isPremium: row.isPremiumOnly,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/live-recording/handoff.ts
git commit -m "feat: thread isPremiumOnly from live recordings to distribution jobs"
```

---

## Task 8: Verification — Premium-Aware Checks

**Files:**
- Modify: `src/lib/jobs/verify-distribution.ts`

- [ ] **Step 1: Add isPremium to CheckCtx**

In `src/lib/jobs/verify-distribution.ts`, add to the `CheckCtx` interface (around line 65):

```typescript
interface CheckCtx {
  jobId: string;
  wpShowId: number;
  expectedTitle: string;
  isLiveRecording: boolean;
  isPremium: boolean;
}
```

- [ ] **Step 2: Update YouTube verification**

In `ytTier`, skip for premium just like live recordings (around line 79):

```typescript
if (ctx.isLiveRecording || ctx.isPremium) return []; // skip — unlisted/members-only
```

Wait — premium YouTube videos ARE uploaded by the portal (as unlisted), so we should verify they exist, just not check the public URL. Instead, modify the tier 4 public URL check to skip for premium:

```typescript
if (tier === 4) {
  if (!ctx.isPremium) {
    const reach = await checkUrlReachable(`https://www.youtube.com/watch?v=${videoId}`);
    if (!reach.ok) {
      issues.push({ platform: "youtube", field: "public_url", expected: "200", actual: `${reach.status ?? "unreachable"}` });
    }
  }
}
```

Also accept `unlisted` as valid privacy in the status check. In the tier >= 3 section, if premium, accept unlisted privacy:

After the existing `uploadStatus` check, add privacy validation for premium:

```typescript
if (ctx.isPremium && v.status?.privacyStatus !== "unlisted" && v.status?.privacyStatus !== "private") {
  issues.push({ platform: "youtube", field: "privacyStatus", expected: "unlisted", actual: v.status?.privacyStatus ?? "unknown" });
}
```

- [ ] **Step 3: Thread isPremium through runVerificationTier**

Update the `runVerificationTier` function signature to accept `isPremium`:

```typescript
export async function runVerificationTier(
  tier: 1 | 2 | 3 | 4,
  jobId: string,
  wpShowId: number,
  expectedTitle: string,
  isLiveRecording = false,
  isPremium = false,
): Promise<TierResult> {
```

And pass it to `ctx`:

```typescript
const ctx: CheckCtx = { jobId, wpShowId, expectedTitle, isLiveRecording, isPremium };
```

- [ ] **Step 4: Update processor verification call**

In `src/lib/jobs/processor.ts`, find `scheduleVerificationTiers` (around line 767) and pass the premium flag:

```typescript
function scheduleVerificationTiers(
  jobId: string,
  wpShowId: number,
  title: string,
  isLiveRecording: boolean,
  isPremium: boolean,
) {
  const tiers: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];
  for (const tier of tiers) {
    const delay = VERIFICATION_TIER_DELAYS_MS[tier];
    setTimeout(() => {
      runVerificationTier(tier, jobId, wpShowId, title, isLiveRecording, isPremium)
        .then((result) => maybeNotifyTierFailure(jobId, wpShowId, title, result))
        .catch((err) => {
          console.error(`[verify] tier ${tier} failed for job ${jobId}:`, err);
        });
    }, delay).unref?.();
  }
}
```

Update the call site (around line 754) to pass `job.isPremium`:

```typescript
scheduleVerificationTiers(job.id, job.wpShowId, job.title, !!existingYoutubeUrl, job.isPremium);
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/verify-distribution.ts src/lib/jobs/processor.ts
git commit -m "feat: make verification premium-aware — skip public URL checks for gated content"
```

---

## Task 9: Job Detail View — YouTube Studio Reminder

**Files:**
- Modify: `src/app/dashboard/distribute/[id]/job-detail-view.tsx`

- [ ] **Step 1: Show reminder for premium YouTube jobs**

In `job-detail-view.tsx`, find where platform statuses are displayed. Add a banner when the job is premium and YouTube is included:

```tsx
{job.isPremium && platforms.some(p => p.platform === "youtube" && p.status === "completed") && (
  <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
    <strong>Premium content:</strong> This video was uploaded as unlisted. 
    To restrict to channel members, set it to &quot;Members only&quot; in YouTube Studio.
  </div>
)}
```

Place this near the top of the job detail view, after the status badges.

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/distribute/[id]/job-detail-view.tsx
git commit -m "feat: show YouTube Studio reminder for premium distributions"
```

---

## Task 10: Transistor Subscriber API Client

**Files:**
- Create: `src/lib/transistor-subscribers.ts`

- [ ] **Step 1: Create the subscriber client**

Create `src/lib/transistor-subscribers.ts`:

```typescript
import { getTransistorApiKey } from "@/lib/analytics/credentials";

const TRANSISTOR_API_URL = "https://api.transistor.fm/v1";

function fetchTimeout(): AbortSignal {
  return AbortSignal.timeout(30_000);
}

export async function addTransistorSubscriber(
  wpShowId: number,
  transistorShowId: string,
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const apiKey = await getTransistorApiKey(wpShowId);
  if (!apiKey) return { success: false, error: "No Transistor API key" };

  const res = await fetch(`${TRANSISTOR_API_URL}/subscribers`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      show_id: transistorShowId,
      email,
      skip_welcome_email: true,
    }),
    signal: fetchTimeout(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 422 = already exists, treat as success
    if (res.status === 422 && body.includes("already")) {
      return { success: true };
    }
    return { success: false, error: `Transistor API ${res.status}: ${body}` };
  }

  return { success: true };
}

export async function removeTransistorSubscriber(
  wpShowId: number,
  transistorShowId: string,
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const apiKey = await getTransistorApiKey(wpShowId);
  if (!apiKey) return { success: false, error: "No Transistor API key" };

  const res = await fetch(
    `${TRANSISTOR_API_URL}/subscribers?show_id=${transistorShowId}&email=${encodeURIComponent(email)}`,
    {
      method: "DELETE",
      headers: { "x-api-key": apiKey },
      signal: fetchTimeout(),
    },
  );

  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    return { success: false, error: `Transistor API ${res.status}: ${body}` };
  }

  return { success: true };
}

export async function listTransistorSubscribers(
  wpShowId: number,
  transistorShowId: string,
): Promise<{ emails: string[]; error?: string }> {
  const apiKey = await getTransistorApiKey(wpShowId);
  if (!apiKey) return { emails: [], error: "No Transistor API key" };

  const allEmails: string[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${TRANSISTOR_API_URL}/subscribers?show_id=${transistorShowId}&per_page=100&page=${page}`,
      {
        headers: { "x-api-key": apiKey },
        signal: fetchTimeout(),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { emails: allEmails, error: `Transistor API ${res.status}: ${body}` };
    }

    const data = await res.json() as {
      data: Array<{ attributes: { email: string } }>;
      meta?: { currentPage?: number; totalPages?: number };
    };

    for (const sub of data.data) {
      allEmails.push(sub.attributes.email.toLowerCase());
    }

    const totalPages = data.meta?.totalPages ?? 1;
    if (page >= totalPages) break;
    page++;
  }

  return { emails: allEmails };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/transistor-subscribers.ts
git commit -m "feat: add Transistor subscriber API client for premium podcast sync"
```

---

## Task 11: Portal Webhook Receiver — Subscription Events

**Files:**
- Create: `src/app/api/webhooks/subscription/route.ts`

- [ ] **Step 1: Create the webhook route**

Create `src/app/api/webhooks/subscription/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { addTransistorSubscriber, removeTransistorSubscriber } from "@/lib/transistor-subscribers";

const VALID_EVENTS = ["subscription.created", "subscription.cancelled", "subscription.expired"] as const;
type SubscriptionEvent = (typeof VALID_EVENTS)[number];

interface WebhookPayload {
  event: SubscriptionEvent;
  email: string;
  wpShowId: number;
  scope: "show" | "all_access";
  status: string;
}

export async function POST(request: NextRequest) {
  const secret = process.env.SUBSCRIPTION_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[subscription-webhook] SUBSCRIPTION_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!VALID_EVENTS.includes(payload.event as SubscriptionEvent)) {
    return NextResponse.json({ error: `Unknown event: ${payload.event}` }, { status: 400 });
  }

  if (!payload.email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  const email = payload.email.toLowerCase().trim();
  const isGrant = payload.event === "subscription.created";

  // Resolve which shows to sync
  let showsToSync: Array<{ wpShowId: number; transistorPrivateShowId: string }>;

  if (payload.scope === "all_access") {
    // All-access: sync to ALL premium-enabled shows
    showsToSync = await db.showMetadata.findMany({
      where: { premiumEnabled: true, transistorPrivateShowId: { not: null } },
      select: { wpShowId: true, transistorPrivateShowId: true },
    }) as Array<{ wpShowId: number; transistorPrivateShowId: string }>;
  } else {
    // Per-show: sync to this show only
    const meta = await db.showMetadata.findUnique({
      where: { wpShowId: payload.wpShowId },
      select: { wpShowId: true, transistorPrivateShowId: true, premiumEnabled: true },
    });

    if (!meta?.premiumEnabled || !meta.transistorPrivateShowId) {
      console.warn(`[subscription-webhook] Show ${payload.wpShowId} not premium-enabled or missing Transistor ID`);
      return NextResponse.json({ ok: true, skipped: true });
    }

    showsToSync = [{ wpShowId: meta.wpShowId, transistorPrivateShowId: meta.transistorPrivateShowId }];
  }

  const results = await Promise.allSettled(
    showsToSync.map(async (show) => {
      const fn = isGrant ? addTransistorSubscriber : removeTransistorSubscriber;
      const result = await fn(show.wpShowId, show.transistorPrivateShowId, email);
      if (!result.success) {
        console.error(`[subscription-webhook] ${payload.event} failed for ${email} on show ${show.wpShowId}: ${result.error}`);
      }
      return { wpShowId: show.wpShowId, ...result };
    }),
  );

  const failures = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success));

  console.log(
    `[subscription-webhook] ${payload.event} for ${email}: ${showsToSync.length} shows, ${failures.length} failures`,
  );

  return NextResponse.json({ ok: true, synced: showsToSync.length, failures: failures.length });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/webhooks/subscription/
git commit -m "feat: add webhook receiver for website subscription events → Transistor sync"
```

---

## Task 12: Nightly Reconciliation Cron

**Files:**
- Create: `src/app/api/cron/reconcile-subscribers/route.ts`

- [ ] **Step 1: Create the reconciliation endpoint**

Create `src/app/api/cron/reconcile-subscribers/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  addTransistorSubscriber,
  removeTransistorSubscriber,
  listTransistorSubscribers,
} from "@/lib/transistor-subscribers";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const wpApiUrl = process.env.WP_API_URL;
  const wpAuth = "Basic " + Buffer.from(`${process.env.WP_APP_USER}:${process.env.WP_APP_PASSWORD}`).toString("base64");

  if (!wpApiUrl) {
    return NextResponse.json({ error: "WP_API_URL not configured" }, { status: 500 });
  }

  // Get all premium-enabled shows
  const premiumShows = await db.showMetadata.findMany({
    where: { premiumEnabled: true, transistorPrivateShowId: { not: null } },
  });

  if (premiumShows.length === 0) {
    return NextResponse.json({ message: "No premium shows configured", synced: 0 });
  }

  // Fetch subscriber list from WordPress
  const wpRes = await fetch(`${wpApiUrl.replace("/wp/v2", "")}/swm-premium/v1/subscribers`, {
    headers: { Authorization: wpAuth },
    signal: AbortSignal.timeout(30_000),
  });

  if (!wpRes.ok) {
    const body = await wpRes.text().catch(() => "");
    return NextResponse.json({ error: `WP subscriber API failed: ${wpRes.status} ${body}` }, { status: 502 });
  }

  const wpSubscribers = await wpRes.json() as Record<string, string[]>;
  // Shape: { "21": ["email1@example.com", "email2@example.com"], ... }
  // Key "0" = all-access subscribers

  const allAccessEmails = (wpSubscribers["0"] ?? []).map((e: string) => e.toLowerCase());

  let totalAdded = 0;
  let totalRemoved = 0;

  for (const show of premiumShows) {
    const showEmails = (wpSubscribers[String(show.wpShowId)] ?? []).map((e: string) => e.toLowerCase());
    const expectedEmails = new Set([...showEmails, ...allAccessEmails]);

    const { emails: transistorEmails, error } = await listTransistorSubscribers(
      show.wpShowId,
      show.transistorPrivateShowId!,
    );

    if (error) {
      console.error(`[reconcile] Failed to list Transistor subscribers for show ${show.wpShowId}: ${error}`);
      continue;
    }

    const transistorSet = new Set(transistorEmails);

    // Add missing
    for (const email of expectedEmails) {
      if (!transistorSet.has(email)) {
        await addTransistorSubscriber(show.wpShowId, show.transistorPrivateShowId!, email);
        totalAdded++;
      }
    }

    // Remove stale
    for (const email of transistorEmails) {
      if (!expectedEmails.has(email)) {
        await removeTransistorSubscriber(show.wpShowId, show.transistorPrivateShowId!, email);
        totalRemoved++;
      }
    }
  }

  const message = `Reconciliation complete: ${totalAdded} added, ${totalRemoved} removed across ${premiumShows.length} shows`;
  console.log(`[reconcile] ${message}`);

  return NextResponse.json({ ok: true, message, added: totalAdded, removed: totalRemoved });
}
```

- [ ] **Step 2: Set up Railway cron**

Add a Railway cron trigger for this endpoint. Use the existing cron pattern — the `live-recording-poll-cron` service on Railway is a reference. Schedule nightly at 4:00 AM CT:

```
0 9 * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://portal.stolenwatermedia.com/api/cron/reconcile-subscribers
```

(9:00 UTC = 4:00 AM CT)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/reconcile-subscribers/
git commit -m "feat: add nightly subscriber reconciliation cron for Transistor private shows"
```

---

## Task 13: WordPress Plugin — Subscription Webhook to Portal

**Repo:** website-stolenwatermedia

**Files:**
- Modify: `plugins/swm-premium/includes/class-stripe.php`

- [ ] **Step 1: Add webhook notification function**

In `plugins/swm-premium/includes/class-stripe.php`, add a static method that fires the portal webhook:

```php
/**
 * Notify the producer portal of a subscription change so it can sync
 * Transistor private show subscribers.
 */
private static function notify_portal( $event, $email, $show_id, $scope = 'show' ) {
    $portal_url = defined( 'SWM_PORTAL_WEBHOOK_URL' )
        ? SWM_PORTAL_WEBHOOK_URL
        : 'https://portal.stolenwatermedia.com/api/webhooks/subscription';

    $secret = defined( 'SWM_PORTAL_WEBHOOK_SECRET' ) ? SWM_PORTAL_WEBHOOK_SECRET : '';
    if ( empty( $secret ) ) {
        error_log( '[swm-premium] SWM_PORTAL_WEBHOOK_SECRET not defined, skipping portal notification' );
        return;
    }

    // Resolve the portal-compatible wpShowId from the WP show's parent_show_id meta
    $wp_show_id = 0;
    if ( $scope === 'show' && $show_id > 0 ) {
        $wp_show_id = (int) get_post_meta( $show_id, 'parent_show_id', true );
    }

    $body = wp_json_encode( [
        'event'    => $event,
        'email'    => $email,
        'wpShowId' => $wp_show_id,
        'scope'    => $scope,
        'status'   => $event === 'subscription.created' ? 'active' : 'cancelled',
    ] );

    wp_remote_post( $portal_url, [
        'headers'  => [
            'Content-Type'  => 'application/json',
            'Authorization' => 'Bearer ' . $secret,
        ],
        'body'     => $body,
        'timeout'  => 15,
        'blocking' => false, // fire-and-forget
    ] );
}
```

- [ ] **Step 2: Hook into subscription lifecycle events**

Add `notify_portal` calls after the database writes in each handler:

In `handle_checkout_completed()` — after the `SWM_Premium_Subscriptions::create()` call (around line 419):

```php
self::notify_portal( 'subscription.created', $email, $show_id, $scope );
```

In `handle_subscription_updated()` — after the status update (around line 666). If status changed to cancelled/past_due:

```php
if ( in_array( $new_status, [ 'canceled', 'past_due', 'unpaid' ], true ) ) {
    self::notify_portal( 'subscription.cancelled', $email, $show_id, $scope );
}
```

In `handle_subscription_deleted()` — after marking expired (around line 690):

```php
self::notify_portal( 'subscription.expired', $email, $show_id, $scope );
```

- [ ] **Step 3: Add wp-config constant**

On the Cloudways production server, add to `wp-config.php`:

```php
define( 'SWM_PORTAL_WEBHOOK_SECRET', '<same-value-as-SUBSCRIPTION_WEBHOOK_SECRET-on-Railway>' );
```

- [ ] **Step 4: Commit (website repo)**

```bash
cd /Users/bretkramer/Development/bwk-digital/website-stolenwatermedia
git add plugins/swm-premium/includes/class-stripe.php
git commit -m "feat: notify producer portal on subscription lifecycle events for Transistor sync"
```

---

## Task 14: WordPress Plugin — Subscriber List REST Endpoint

**Repo:** website-stolenwatermedia

**Files:**
- Create: `plugins/swm-premium/includes/class-rest-api.php`
- Modify: `plugins/swm-premium/swm-premium.php`

- [ ] **Step 1: Create the REST API class**

Create `plugins/swm-premium/includes/class-rest-api.php`:

```php
<?php
/**
 * REST API endpoints for the SWM Premium plugin.
 */
class SWM_Premium_REST_API {

    public static function init() {
        add_action( 'rest_api_init', [ __CLASS__, 'register_routes' ] );
    }

    public static function register_routes() {
        register_rest_route( 'swm-premium/v1', '/subscribers', [
            'methods'             => 'GET',
            'callback'            => [ __CLASS__, 'get_subscribers' ],
            'permission_callback' => function ( $request ) {
                return current_user_can( 'manage_options' );
            },
        ] );
    }

    /**
     * Returns active subscribers grouped by show wpShowId.
     * All-access subscribers are under key "0".
     *
     * Response shape: { "0": ["email1", ...], "21": ["email2", ...] }
     */
    public static function get_subscribers( $request ) {
        global $wpdb;

        $table_subscriptions = $wpdb->prefix . 'swm_subscriptions';
        $table_subscribers   = $wpdb->prefix . 'swm_subscribers';

        // Active subscriptions (Stripe-based)
        $rows = $wpdb->get_results( "
            SELECT sub.email, s.show_id, s.scope
            FROM {$table_subscriptions} s
            JOIN {$table_subscribers} sub ON sub.id = s.subscriber_id
            WHERE s.status = 'active'
        " );

        $grouped = [];

        foreach ( $rows as $row ) {
            $email = strtolower( trim( $row->email ) );

            if ( $row->scope === 'all_access' ) {
                $key = '0';
            } else {
                // Resolve portal-compatible wpShowId from the WP show post
                $wp_show_id = (int) get_post_meta( $row->show_id, 'parent_show_id', true );
                $key = (string) $wp_show_id;
            }

            if ( ! isset( $grouped[ $key ] ) ) {
                $grouped[ $key ] = [];
            }

            if ( ! in_array( $email, $grouped[ $key ], true ) ) {
                $grouped[ $key ][] = $email;
            }
        }

        // Also include active legacy grants
        $table_grants = $wpdb->prefix . 'swm_grants';
        $grants = $wpdb->get_results( "
            SELECT email, brand_term_id
            FROM {$table_grants}
            WHERE (valid_until IS NULL OR valid_until > NOW())
            AND migrated_to_stripe_at IS NULL
        " );

        foreach ( $grants as $grant ) {
            $email = strtolower( trim( $grant->email ) );
            // Legacy grants are brand-scoped, not show-scoped.
            // Find shows with this brand term and add to each.
            $show_ids = get_posts( [
                'post_type'  => 'swm_show',
                'fields'     => 'ids',
                'numberposts' => -1,
                'tax_query'  => [ [
                    'taxonomy' => 'swm_brand',
                    'terms'    => (int) $grant->brand_term_id,
                ] ],
            ] );

            foreach ( $show_ids as $show_post_id ) {
                $wp_show_id = (int) get_post_meta( $show_post_id, 'parent_show_id', true );
                $key = (string) $wp_show_id;
                if ( ! isset( $grouped[ $key ] ) ) {
                    $grouped[ $key ] = [];
                }
                if ( ! in_array( $email, $grouped[ $key ], true ) ) {
                    $grouped[ $key ][] = $email;
                }
            }
        }

        return new WP_REST_Response( $grouped, 200 );
    }
}
```

- [ ] **Step 2: Include the new class**

In `plugins/swm-premium/swm-premium.php`, add after the existing `require_once` includes (around line 41):

```php
require_once __DIR__ . '/includes/class-rest-api.php';
SWM_Premium_REST_API::init();
```

- [ ] **Step 3: Commit (website repo)**

```bash
cd /Users/bretkramer/Development/bwk-digital/website-stolenwatermedia
git add plugins/swm-premium/includes/class-rest-api.php plugins/swm-premium/swm-premium.php
git commit -m "feat: add REST endpoint for subscriber list grouped by show (for Transistor reconciliation)"
```

---

## Task 15: Environment Variables & Deployment

- [ ] **Step 1: Add SUBSCRIPTION_WEBHOOK_SECRET to Railway**

Generate a secret:
```bash
openssl rand -hex 32
```

Set on Railway portal (both staging and production):
```bash
railway variables set SUBSCRIPTION_WEBHOOK_SECRET=<generated-secret>
```

- [ ] **Step 2: Add to Cloudways wp-config.php**

SSH to the Cloudways production server and add to `wp-config.php`:

```php
define( 'SWM_PORTAL_WEBHOOK_SECRET', '<same-secret-as-above>' );
```

- [ ] **Step 3: Deploy website changes**

Deploy the WordPress plugin changes to the Cloudways production server via the existing deployment script.

- [ ] **Step 4: Deploy portal changes**

Push to `main` (staging autodeploy) and `production` (production autodeploy):

```bash
git push origin main
git checkout production && git merge main && git push origin production
```

- [ ] **Step 5: Run initial reconciliation**

After both sides are deployed, trigger the initial reconciliation to seed Transistor subscribers:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://portal.stolenwatermedia.com/api/cron/reconcile-subscribers
```

- [ ] **Step 6: Set up Railway cron for nightly reconciliation**

Configure the Railway cron service to hit the reconciliation endpoint nightly at 4:00 AM CT (9:00 UTC).
