"use client";

import { ChevronRightIcon } from "lucide-react";

interface EpisodeGroupProps {
  title: string;
  showName: string;
  summary: string;
  children: React.ReactNode;
}

export function EpisodeGroup({
  title,
  showName,
  summary,
  children,
}: EpisodeGroupProps) {
  return (
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/50">
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{title}</p>
          <p className="text-xs text-muted-foreground">{showName}</p>
        </div>
        <p className="text-xs text-muted-foreground shrink-0">{summary}</p>
      </summary>
      <div className="space-y-4 px-4 pb-4 pt-2">{children}</div>
    </details>
  );
}
