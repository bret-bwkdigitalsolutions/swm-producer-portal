"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { NETWORKS, type Network } from "@/lib/analytics/networks";
import type { AccessibleShow } from "@/lib/analytics/types";

export type AnalyticsSelection =
  | { level: "all" }
  | { level: "network"; network: Network }
  | { level: "show"; wpShowId: number; showName: string };

interface AnalyticsSelectionContextType {
  selection: AnalyticsSelection;
  setSelection: (selection: AnalyticsSelection) => void;
  showsInScope: number[];
  accessibleShows: AccessibleShow[];
  setAccessibleShows: (shows: AccessibleShow[]) => void;
  role: string | null;
  setRole: (role: string | null) => void;
}

const AnalyticsSelectionContext =
  createContext<AnalyticsSelectionContextType | null>(null);

export function useAnalyticsSelection() {
  const ctx = useContext(AnalyticsSelectionContext);
  if (!ctx)
    throw new Error(
      "useAnalyticsSelection must be used within AnalyticsSelectionProvider"
    );
  return ctx;
}

function selectionToParams(selection: AnalyticsSelection): string {
  const params = new URLSearchParams();
  if (selection.level === "all") {
    params.set("level", "all");
  } else if (selection.level === "network") {
    params.set("level", "network");
    params.set("network", selection.network.slug);
  } else {
    params.set("show", String(selection.wpShowId));
  }
  return params.toString();
}

function parseSelection(searchParams: URLSearchParams): AnalyticsSelection {
  const showParam = searchParams.get("show");
  if (showParam) {
    const wpShowId = parseInt(showParam, 10);
    if (!isNaN(wpShowId)) {
      return { level: "show", wpShowId, showName: "" };
    }
  }

  const levelParam = searchParams.get("level");
  const networkParam = searchParams.get("network");

  if (levelParam === "network" && networkParam) {
    const network = NETWORKS.find((n) => n.slug === networkParam);
    if (network) {
      return { level: "network", network };
    }
  }

  return { level: "all" };
}

function getShowsInScope(
  selection: AnalyticsSelection,
  accessibleShows: AccessibleShow[]
): number[] {
  if (selection.level === "show") {
    return [selection.wpShowId];
  }
  if (selection.level === "network") {
    const networkIds = new Set(selection.network.wpShowIds);
    return accessibleShows
      .filter((s) => networkIds.has(s.wpShowId))
      .map((s) => s.wpShowId);
  }
  // "all" — return all accessible shows
  return accessibleShows.map((s) => s.wpShowId);
}

export default function AnalyticsSelectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [accessibleShows, setAccessibleShows] = useState<AccessibleShow[]>([]);
  const [role, setRole] = useState<string | null>(null);

  const [selection, setSelectionState] = useState<AnalyticsSelection>(() =>
    parseSelection(searchParams)
  );

  // Sync selection from URL when searchParams change externally
  useEffect(() => {
    const parsed = parseSelection(searchParams);
    setSelectionState((prev) => {
      if (prev.level === parsed.level) {
        if (parsed.level === "all") return prev;
        if (
          parsed.level === "network" &&
          prev.level === "network" &&
          prev.network.slug === parsed.network.slug
        )
          return prev;
        if (
          parsed.level === "show" &&
          prev.level === "show" &&
          prev.wpShowId === parsed.wpShowId
        )
          return prev;
      }
      return parsed;
    });
  }, [searchParams]);

  const setSelection = useCallback(
    (newSelection: AnalyticsSelection) => {
      setSelectionState(newSelection);
      const paramString = selectionToParams(newSelection);
      router.replace(`?${paramString}`);
    },
    [router]
  );

  const showsInScope = getShowsInScope(selection, accessibleShows);

  return (
    <AnalyticsSelectionContext.Provider
      value={{
        selection,
        setSelection,
        showsInScope,
        accessibleShows,
        setAccessibleShows,
        role,
        setRole,
      }}
    >
      {children}
    </AnalyticsSelectionContext.Provider>
  );
}
