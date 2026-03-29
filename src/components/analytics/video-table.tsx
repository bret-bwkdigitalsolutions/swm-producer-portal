"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import type { YouTubeVideo } from "@/lib/analytics/types";
import { formatNumber } from "@/lib/analytics/date-utils";

type SortField = "title" | "publishedAt" | "viewCount";
type SortDir = "asc" | "desc";

interface VideoTableProps {
  videos: YouTubeVideo[];
  limit?: number;
}

export default function VideoTable({ videos, limit }: VideoTableProps) {
  const [sortField, setSortField] = useState<SortField>("publishedAt");
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
    const arr = [...videos].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case "title":
          aVal = a.title.toLowerCase();
          bVal = b.title.toLowerCase();
          break;
        case "publishedAt":
          aVal = a.publishedAt;
          bVal = b.publishedAt;
          break;
        case "viewCount":
          aVal = a.viewCount;
          bVal = b.viewCount;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return limit ? arr.slice(0, limit) : arr;
  }, [videos, sortField, sortDir, limit]);

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " \u2191" : " \u2193";
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="w-12 px-4 py-3" />
            <th
              className="cursor-pointer px-4 py-3 hover:text-foreground"
              onClick={() => handleSort("title")}
            >
              Title{sortIcon("title")}
            </th>
            <th
              className="cursor-pointer px-4 py-3 hover:text-foreground"
              onClick={() => handleSort("publishedAt")}
            >
              Published{sortIcon("publishedAt")}
            </th>
            <th
              className="cursor-pointer px-4 py-3 text-right hover:text-foreground"
              onClick={() => handleSort("viewCount")}
            >
              Views{sortIcon("viewCount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((video) => (
            <tr key={video.id} className="border-b hover:bg-muted/50">
              <td className="px-4 py-3">
                {video.thumbnailUrl && (
                  <Image
                    src={video.thumbnailUrl}
                    alt=""
                    width={64}
                    height={36}
                    className="rounded object-cover"
                  />
                )}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/dashboard/analytics/youtube/videos/${video.id}`}
                  className="text-primary hover:underline"
                >
                  {video.title}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(video.publishedAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-right">
                {formatNumber(video.viewCount)}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="py-8 text-center text-muted-foreground"
              >
                No videos found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
