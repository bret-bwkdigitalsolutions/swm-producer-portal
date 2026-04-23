"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { JobCard, type DistributionJobSummary } from "./job-card";

export interface DayGroup {
  date: string; // e.g. "April 22, 2026"
  jobs: DistributionJobSummary[];
}

function summarize(jobs: DistributionJobSummary[]) {
  const completed = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const other = jobs.length - completed - failed;

  const parts: string[] = [];
  if (completed) parts.push(`${completed} completed`);
  if (failed) parts.push(`${failed} failed`);
  if (other) parts.push(`${other} in progress`);
  return parts.join(", ");
}

export function GroupedJobList({ groups }: { groups: DayGroup[] }) {
  // Today's group starts expanded, others collapsed
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (groups.length > 0) initial.add(groups[0].date);
    return initial;
  });

  function toggle(date: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const isOpen = expanded.has(group.date);
        return (
          <div key={group.date}>
            <button
              type="button"
              onClick={() => toggle(group.date)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/50"
            >
              {isOpen ? (
                <ChevronDownIcon className="size-4 text-muted-foreground" />
              ) : (
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              )}
              <span className="font-semibold">{group.date}</span>
              <span className="text-sm text-muted-foreground">
                — {group.jobs.length} job{group.jobs.length !== 1 ? "s" : ""}
                {!isOpen && (
                  <span className="ml-1">({summarize(group.jobs)})</span>
                )}
              </span>
            </button>
            {isOpen && (
              <div className="mt-2 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {group.jobs.map((job) => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
