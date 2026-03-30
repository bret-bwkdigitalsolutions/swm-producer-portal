"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { CONTENT_TYPE_LABELS } from "@/lib/constants";

interface SidebarProps {
  visibleContentTypes: string[];
}

export function Sidebar({ visibleContentTypes }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();

  const navItems = [
    { label: "Dashboard", href: "/dashboard" },
    ...visibleContentTypes
      .filter((type) => type !== "episode")
      .map((type) => ({
        label:
          CONTENT_TYPE_LABELS[type as keyof typeof CONTENT_TYPE_LABELS] ?? type,
        href: `/dashboard/${type.replace("_", "-")}`,
      })),
    { label: "Analytics", href: "/dashboard/analytics" },
    ...(session?.user?.hasDistributionAccess
      ? [{ label: "Episode Distribution", href: "/dashboard/distribute" }]
      : []),
    { label: "Settings", href: "/settings" },
  ];

  const isAdmin = session?.user?.role === "admin";
  if (isAdmin) {
    navItems.push({ label: "Admin", href: "/admin" });
  }

  return (
    <aside className="flex w-64 flex-col border-r bg-gray-50">
      <div className="p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Navigation
        </p>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-gray-200 text-gray-900"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
