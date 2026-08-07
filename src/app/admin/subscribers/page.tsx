import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  isMembershipApiConfigured,
  listSubscribers,
  getSubscriberCounts,
  buildSubscribersQuery,
  MembershipApiError,
} from "@/lib/membership/client";
import type { SubscriberListFilters } from "@/lib/membership/types";
import { shirtFulfillment } from "@/lib/membership/types";
import { SubscribersFilters } from "./subscribers-filters";
import {
  AccessBadge,
  ShirtBadge,
  planLabel,
  shortDate,
  subscriptionStatusLabel,
} from "./display";

type RawParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseFilters(sp: RawParams): SubscriberListFilters {
  const status = one(sp.status) as SubscriberListFilters["status"] | undefined;
  const source = one(sp.source) as SubscriberListFilters["source"] | undefined;
  const shirt = one(sp.shirt) as SubscriberListFilters["shirt"] | undefined;
  const showIdRaw = one(sp.show_id);
  const pageRaw = one(sp.page);
  return {
    search: one(sp.search),
    status,
    source,
    shirt,
    show_id: showIdRaw ? parseInt(showIdRaw, 10) : undefined,
    page: pageRaw ? parseInt(pageRaw, 10) : 1,
    per_page: 50,
  };
}

function StatTile({
  label,
  value,
  href,
}: {
  label: string;
  value: number | null;
  /** When set, the tile is a link that applies the matching filter. */
  href?: string;
}) {
  const body = (
    <CardContent className="p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold">
        {value == null ? "—" : value.toLocaleString()}
      </p>
      {href && (
        <p className="mt-0.5 text-[11px] text-primary">View &rarr;</p>
      )}
    </CardContent>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        <Card className="transition-colors hover:border-primary/50 hover:bg-muted/40">
          {body}
        </Card>
      </Link>
    );
  }
  return <Card>{body}</Card>;
}

export default async function AdminSubscribersPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);

  if (!isMembershipApiConfigured()) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Subscribers</h2>
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The membership API is not configured yet. Set{" "}
          <code className="font-mono">SWM_MEMBERSHIP_API_TOKEN</code> (and
          optionally <code className="font-mono">SWM_MEMBERSHIP_API_URL</code>)
          in the portal environment. This dashboard reads and edits the
          membership base live from the WordPress site — no data is stored here.
        </div>
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof listSubscribers>> | null = null;
  let counts: Awaited<ReturnType<typeof getSubscriberCounts>> | null = null;
  let errorMessage: string | null = null;
  try {
    [data, counts] = await Promise.all([
      listSubscribers(filters),
      getSubscriberCounts(),
    ]);
  } catch (err) {
    errorMessage =
      err instanceof MembershipApiError
        ? err.message
        : "Failed to load subscribers.";
  }

  const exportQs = buildSubscribersQuery({ ...filters, page: 1, per_page: 200 });

  const page = filters.page ?? 1;
  const perPage = 50;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const val = one(v);
      if (val) qs.set(k, val);
    }
    qs.set("page", String(targetPage));
    return `/admin/subscribers?${qs.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Subscribers</h2>
        <a href={`/admin/subscribers/export?${exportQs}`}>
          <Button variant="outline" size="sm">
            Export CSV
          </Button>
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Total"
          value={counts?.total ?? null}
          href="/admin/subscribers"
        />
        <StatTile
          label="Active"
          value={counts?.active ?? null}
          href="/admin/subscribers?status=active"
        />
        {/* Not clickable: Migrators = Patreon + Apple-legacy, but the API's
            source filter is single-value, so no one URL returns the exact set.
            Use the Source filter (Patreon / Apple) to drill in. */}
        <StatTile label="Migrators" value={counts?.migrators ?? null} />
        <StatTile
          label="Shirts to ship"
          value={counts?.shirtsAwaiting ?? null}
          href="/admin/subscribers?shirt=claimed"
        />
      </div>

      <SubscribersFilters />

      {errorMessage ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errorMessage} The WordPress membership API may still be deploying —
          try again shortly.
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {total.toLocaleString()} subscriber{total === 1 ? "" : "s"}
              {filters.search || filters.status || filters.source || filters.shirt
                ? " (filtered)"
                : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Renews</TableHead>
                    <TableHead>Shirt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.subscribers ?? []).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link
                          href={`/admin/subscribers/${s.id}`}
                          className="font-medium hover:underline"
                        >
                          {s.display_name || "(no name)"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.email}
                      </TableCell>
                      <TableCell>{s.is_migrator ? "Migrator" : "New"}</TableCell>
                      <TableCell>{planLabel(s.subscription)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <AccessBadge access={s.access} />
                          <span className="text-xs text-muted-foreground">
                            {subscriptionStatusLabel(s.subscription?.status)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {shortDate(s.subscription?.current_period_end)}
                      </TableCell>
                      <TableCell>
                        <ShirtBadge status={shirtFulfillment(s.shirt)} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {(data?.subscribers ?? []).length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        No subscribers match these filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link href={pageHref(page - 1)}>
                      <Button variant="outline" size="sm">
                        Previous
                      </Button>
                    </Link>
                  )}
                  {page < totalPages && (
                    <Link href={pageHref(page + 1)}>
                      <Button variant="outline" size="sm">
                        Next
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
