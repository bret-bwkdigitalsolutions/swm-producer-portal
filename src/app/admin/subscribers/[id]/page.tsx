import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  isMembershipApiConfigured,
  getSubscriber,
  MembershipApiError,
} from "@/lib/membership/client";
import { shirtFulfillment } from "@/lib/membership/types";
import {
  AccessBadge,
  ShirtBadge,
  planLabel,
  shortDate,
  subscriptionStatusLabel,
} from "../display";
import { SubscriberEditForm } from "./subscriber-edit-form";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export default async function SubscriberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isFinite(id) || id <= 0) notFound();

  if (!isMembershipApiConfigured()) {
    return (
      <div className="space-y-4">
        <Link href="/admin/subscribers">
          <Button variant="ghost" size="sm">
            &larr; Back
          </Button>
        </Link>
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The membership API is not configured yet.
        </div>
      </div>
    );
  }

  let subscriber;
  try {
    subscriber = await getSubscriber(id);
  } catch (err) {
    if (err instanceof MembershipApiError && err.status === 404) notFound();
    return (
      <div className="space-y-4">
        <Link href="/admin/subscribers">
          <Button variant="ghost" size="sm">
            &larr; Back
          </Button>
        </Link>
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {err instanceof MembershipApiError
            ? err.message
            : "Failed to load subscriber."}
        </div>
      </div>
    );
  }

  const { subscription: sub, grant, shirt } = subscriber;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/subscribers">
          <Button variant="ghost" size="sm">
            &larr; Back
          </Button>
        </Link>
        <h2 className="text-2xl font-bold">
          {subscriber.display_name || subscriber.email}
        </h2>
        <AccessBadge access={subscriber.access} />
        {subscriber.is_migrator && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            Migrator
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Account */}
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            <Field label="Email">{subscriber.email}</Field>
            <Field label="Sign-in method">{subscriber.auth_provider}</Field>
            <Field label="Joined">{shortDate(subscriber.created_at)}</Field>
            <Field label="Last login">
              {shortDate(subscriber.last_login_at)}
            </Field>
          </CardContent>
        </Card>

        {/* Subscription */}
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {sub ? (
              <>
                <Field label="Status">
                  {subscriptionStatusLabel(sub.status)}
                </Field>
                <Field label="Plan">{planLabel(sub)}</Field>
                <Field label="Renews">
                  {shortDate(sub.current_period_end)}
                </Field>
                <Field label="Started">{shortDate(sub.started_at)}</Field>
                {sub.cancelled_at && (
                  <Field label="Cancelled">{shortDate(sub.cancelled_at)}</Field>
                )}
                <Field label="Stripe subscription">
                  <code className="text-xs">
                    {sub.stripe_subscription_id ?? "—"}
                  </code>
                </Field>
                <Field label="Stripe customer">
                  <code className="text-xs">
                    {sub.stripe_customer_id ?? "—"}
                  </code>
                </Field>
              </>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">
                No site subscription yet
                {grant ? " — on grace access via grant below." : "."}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Grant / migration */}
        {grant && (
          <Card>
            <CardHeader>
              <CardTitle>Migration / grant</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <Field label="Source">{grant.source}</Field>
              <Field label="Grace access until">
                {shortDate(grant.valid_until)}
              </Field>
              <Field label="Migrated to Stripe">
                {grant.migrated_to_stripe_at
                  ? shortDate(grant.migrated_to_stripe_at)
                  : "Not yet"}
              </Field>
              {grant.patreon_since && (
                <Field label="Patreon since">
                  {shortDate(grant.patreon_since)}
                </Field>
              )}
              {grant.patreon_tier && (
                <Field label="Patreon tier">{grant.patreon_tier}</Field>
              )}
            </CardContent>
          </Card>
        )}

        {/* Shirt fulfillment — current status + editable form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              T-shirt fulfillment
              <ShirtBadge status={shirtFulfillment(shirt)} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SubscriberEditForm
              id={subscriber.id}
              displayName={subscriber.display_name ?? ""}
              shirt={shirt}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
