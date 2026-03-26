"use client";

import { useState, useCallback } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CalendarIcon, RocketIcon } from "lucide-react";

export interface PublishState {
  status: "publish" | "future";
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

export function PublishToggle({
  value,
  onChange,
  className,
}: PublishToggleProps) {
  const isScheduled = value.status === "future";

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (checked) {
        const defaultDate = new Date();
        defaultDate.setDate(defaultDate.getDate() + 1);
        defaultDate.setHours(9, 0, 0, 0);
        onChange({
          status: "future",
          date: formatDatetimeLocal(defaultDate),
        });
      } else {
        onChange({ status: "publish" });
      }
    },
    [onChange]
  );

  const handleDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({
        status: "future",
        date: e.target.value,
      });
    },
    [onChange]
  );

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isScheduled ? (
            <CalendarIcon className="size-4 text-muted-foreground" />
          ) : (
            <RocketIcon className="size-4 text-muted-foreground" />
          )}
          <Label htmlFor="publish-toggle" className="cursor-pointer">
            {isScheduled ? "Schedule for later" : "Publish now"}
          </Label>
        </div>
        <Switch
          id="publish-toggle"
          checked={isScheduled}
          onCheckedChange={handleToggle}
        />
      </div>

      {isScheduled && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <Label htmlFor="publish-date" className="text-xs text-muted-foreground">
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

      {/* Hidden inputs for server action form submission */}
      <input type="hidden" name="status" value={value.status} />
      {isScheduled && value.date && (
        <input type="hidden" name="scheduled_date" value={value.date} />
      )}
    </div>
  );
}
