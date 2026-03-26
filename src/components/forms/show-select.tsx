"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Show {
  id: string;
  title: string;
}

interface ShowSelectProps {
  allowedShows: Show[];
  value: string;
  onValueChange: (value: string) => void;
  name?: string;
  label?: string;
  required?: boolean;
  className?: string;
}

function handleValueChange(
  onValueChange: (value: string) => void
) {
  return (value: string | null) => {
    if (value !== null) {
      onValueChange(value);
    }
  };
}

export function ShowSelect({
  allowedShows,
  value,
  onValueChange,
  name = "show_id",
  label = "Show",
  required = true,
  className,
}: ShowSelectProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <Label htmlFor={name}>
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
      )}
      <Select value={value} onValueChange={handleValueChange(onValueChange)} name={name} required={required}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select a show" />
        </SelectTrigger>
        <SelectContent>
          {allowedShows.map((show) => (
            <SelectItem key={show.id} value={show.id}>
              {show.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Hidden input for server action form submission */}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
