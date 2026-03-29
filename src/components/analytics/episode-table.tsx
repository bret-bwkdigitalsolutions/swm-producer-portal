"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TransistorEpisode } from "@/lib/analytics/types";

type SortField = "title" | "published_at";
type SortDir = "asc" | "desc";

interface EpisodeTableProps {
  episodes: TransistorEpisode[];
  limit?: number;
}

export default function EpisodeTable({ episodes, limit }: EpisodeTableProps) {
  const [sortField, setSortField] = useState<SortField>("published_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    const arr = [...episodes].sort((a, b) => {
      let aVal: string;
      let bVal: string;

      switch (sortField) {
        case "title":
          aVal = a.attributes.title.toLowerCase();
          bVal = b.attributes.title.toLowerCase();
          break;
        case "published_at":
          aVal = a.attributes.published_at || "";
          bVal = b.attributes.published_at || "";
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return limit ? arr.slice(0, limit) : arr;
  }, [episodes, sortField, sortDir, limit]);

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " \u2191" : " \u2193";
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th
              className="cursor-pointer px-4 py-3 hover:text-foreground"
              onClick={() => handleSort("title")}
            >
              Title{sortIcon("title")}
            </th>
            <th
              className="cursor-pointer px-4 py-3 hover:text-foreground"
              onClick={() => handleSort("published_at")}
            >
              Published{sortIcon("published_at")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((ep) => (
            <tr key={ep.id} className="border-b hover:bg-muted/50">
              <td className="px-4 py-3">
                <Link
                  href={`/dashboard/analytics/podcasts/episodes/${ep.id}`}
                  className="text-primary hover:underline"
                >
                  {ep.attributes.title}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {ep.attributes.formatted_published_at ||
                  ep.attributes.published_at}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={2}
                className="py-8 text-center text-muted-foreground"
              >
                No episodes found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
