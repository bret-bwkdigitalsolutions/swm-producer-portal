"use client";

import { useState, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CalendarIcon, RocketIcon, FileEditIcon } from "lucide-react";

export interface PublishState {
  status: "publish" | "future" | "draft";
  date?: string;
}

interface PublishToggleProps {
  value: PublishState;
  onChange: (value: PublishState) => void;
  className?: string;
}

function formatDatetimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getMinDatetime(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 5);
  return formatDatetimeLocal(now);
}

const OPTIONS = [
  {
    value: "publish" as const,
    label: "Publish now",
    description: "Goes live immediately",
    icon: RocketIcon,
  },
  {
    value: "draft" as const,
    label: "Save as draft",
    description: "Saved but not visible to audience",
    icon: FileEditIcon,
  },
  {
    value: "future" as const,
    label: "Schedule",
    description: "Publish at a future date/time",
    icon: CalendarIcon,
  },
];

export function PublishToggle({
  value,
  onChange,
  className,
}: PublishToggleProps) {
  const handleSelect = useCallback(
    (status: "publish" | "future" | "draft") => {
      if (status === "future") {
        const defaultDate = new Date();
        defaultDate.setDate(defaultDate.getDate() + 1);
        defaultDate.setHours(9, 0, 0, 0);
        onChange({ status: "future", date: formatDatetimeLocal(defaultDate) });
      } else {
        onChange({ status });
      }
    },
    [onChange]
  );

  const handleDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ status: "future", date: e.target.value });
    },
    [onChange]
  );

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isSelected = value.status === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelect(opt.value)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-center transition-colors",
                isSelected
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/50"
              )}
            >
              <Icon className="size-4" />
              <span className="text-xs font-medium">{opt.label}</span>
              <span className="text-[10px] leading-tight opacity-70">
                {opt.description}
              </span>
            </button>
          );
        })}
      </div>

      {value.status === "future" && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <Label
            htmlFor="publish-date"
            className="text-xs text-muted-foreground"
          >
            Scheduled date and time
          </Label>
          <Input
            id="publish-date"
            type="datetime-local"
            name="publish_date"
            value={value.date || ""}
            onChange={handleDateChange}
            min={getMinDatetime()}
            required
          />
        </div>
      )}

      {value.status === "draft" && (
        <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2">
          Draft content is saved to WordPress but not visible to your audience.
          YouTube uploads will be set to &quot;Unlisted&quot;. You can publish
          later from WordPress or the portal.
        </p>
      )}

      {/* Hidden inputs for server action form submission */}
      <input type="hidden" name="status" value={value.status} />
      {value.status === "future" && value.date && (
        <input type="hidden" name="scheduled_date" value={value.date} />
      )}
    </div>
  );
}
