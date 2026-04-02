"use client";

import { NETWORKS, getNetworkForShow } from "@/lib/analytics/networks";
import {
  useAnalyticsSelection,
  type AnalyticsSelection,
} from "./analytics-selection-provider";

export default function HierarchicalShowSelector() {
  const { selection, setSelection, accessibleShows, role } =
    useAnalyticsSelection();

  if (accessibleShows.length === 0) return null;

  const isAdmin = role === "admin";

  // Group accessible shows by network
  const networkGroups = NETWORKS.map((network) => ({
    network,
    shows: accessibleShows.filter((s) =>
      network.wpShowIds.includes(s.wpShowId)
    ),
  })).filter((g) => g.shows.length > 0);

  // Shows not in any network
  const ungrouped = accessibleShows.filter(
    (s) => !getNetworkForShow(s.wpShowId)
  );

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;

    if (val === "all") {
      setSelection({ level: "all" });
      return;
    }

    if (val.startsWith("network:")) {
      const slug = val.replace("network:", "");
      const network = NETWORKS.find((n) => n.slug === slug);
      if (network) setSelection({ level: "network", network });
      return;
    }

    if (val.startsWith("show:")) {
      const wpShowId = parseInt(val.replace("show:", ""), 10);
      const show = accessibleShows.find((s) => s.wpShowId === wpShowId);
      if (show) {
        setSelection({
          level: "show",
          wpShowId,
          showName: show.title,
        });
      }
      return;
    }
  };

  const currentValue =
    selection.level === "all"
      ? "all"
      : selection.level === "network"
        ? `network:${selection.network.slug}`
        : `show:${selection.wpShowId}`;

  return (
    <select
      value={currentValue}
      onChange={handleChange}
      className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {isAdmin && <option value="all">All Networks</option>}

      {networkGroups.map(({ network, shows }) => (
        <optgroup key={network.slug} label={network.name}>
          {isAdmin && (
            <option value={`network:${network.slug}`}>
              {network.name} (All Shows)
            </option>
          )}
          {shows.map((show) => (
            <option key={show.wpShowId} value={`show:${show.wpShowId}`}>
              {show.title}
            </option>
          ))}
        </optgroup>
      ))}

      {ungrouped.map((show) => (
        <option key={show.wpShowId} value={`show:${show.wpShowId}`}>
          {show.title}
        </option>
      ))}
    </select>
  );
}
