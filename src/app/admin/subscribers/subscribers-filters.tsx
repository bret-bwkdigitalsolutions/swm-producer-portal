"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2Icon } from "lucide-react";

// "all" is the sentinel for "no filter" — base-ui Select needs a concrete value.
const ALL = "all";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "past_due", label: "Past due" },
  { value: "cancelled", label: "Cancelled" },
  { value: "grace", label: "Grace (grant only)" },
  { value: "none", label: "No access" },
];

const SOURCE_OPTIONS = [
  { value: "stripe", label: "New (Stripe)" },
  { value: "patreon", label: "Migrator (Patreon)" },
  { value: "apple_legacy", label: "Migrator (Apple)" },
];

const SHIRT_OPTIONS = [
  { value: "unclaimed", label: "Unclaimed" },
  { value: "claimed", label: "Awaiting shipment" },
  { value: "shipped", label: "Shipped" },
];

export function SubscribersFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get("search") ?? "");

  function apply(next: URLSearchParams) {
    // Any filter change resets to page 1.
    next.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  }

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === ALL) next.delete(key);
    else next.set(key, value);
    apply(next);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setParam("search", search);
  }

  function clearAll() {
    setSearch("");
    startTransition(() => router.push(pathname));
  }

  const hasFilters =
    !!params.get("search") ||
    !!params.get("status") ||
    !!params.get("source") ||
    !!params.get("shirt");

  return (
    <div className="flex flex-wrap items-end gap-3">
      <form onSubmit={submitSearch} className="flex items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Search
          </label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or email…"
            className="h-9 w-56"
          />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          {isPending ? <Loader2Icon className="size-4 animate-spin" /> : "Go"}
        </Button>
      </form>

      <FilterSelect
        label="Status"
        current={params.get("status") ?? ALL}
        options={STATUS_OPTIONS}
        onChange={(v) => setParam("status", v)}
      />
      <FilterSelect
        label="Source"
        current={params.get("source") ?? ALL}
        options={SOURCE_OPTIONS}
        onChange={(v) => setParam("source", v)}
      />
      <FilterSelect
        label="Shirt"
        current={params.get("shirt") ?? ALL}
        options={SHIRT_OPTIONS}
        onChange={(v) => setParam("shirt", v)}
      />

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearAll} disabled={isPending}>
          Clear
        </Button>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  current,
  options,
  onChange,
}: {
  label: string;
  current: string;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Select value={current} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
