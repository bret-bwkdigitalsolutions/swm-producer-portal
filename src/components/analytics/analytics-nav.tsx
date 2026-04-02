"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Overview", href: "/dashboard/analytics" },
  { label: "Podcasts", href: "/dashboard/analytics/podcasts" },
  { label: "YouTube", href: "/dashboard/analytics/youtube" },
  { label: "Compare", href: "/dashboard/analytics/compare" },
];

export default function AnalyticsNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Build query string preserving selection params
  const preservedParams = new URLSearchParams();
  const level = searchParams.get("level");
  const network = searchParams.get("network");
  const show = searchParams.get("show");
  if (show) {
    preservedParams.set("show", show);
  } else if (level) {
    preservedParams.set("level", level);
    if (network) preservedParams.set("network", network);
  }
  const queryString = preservedParams.toString();

  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((tab) => {
        const isActive =
          tab.href === "/dashboard/analytics"
            ? pathname === tab.href
            : pathname.startsWith(tab.href);

        const href = queryString ? `${tab.href}?${queryString}` : tab.href;

        return (
          <Link
            key={tab.href}
            href={href}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
