import { Badge } from "@/components/ui/badge";
import {
  LIVE_RECORDING_STATE_LABELS,
  type LiveRecordingState,
} from "@/lib/live-recording/types";
import { cn } from "@/lib/utils";

const COLORS: Record<LiveRecordingState, string> = {
  scheduled: "bg-blue-100 text-blue-800 border-blue-200",
  live: "bg-red-100 text-red-800 border-red-200 animate-pulse",
  ended_pending: "bg-amber-100 text-amber-800 border-amber-200",
  archived: "bg-green-100 text-green-800 border-green-200",
  cancelled: "bg-gray-100 text-gray-600 border-gray-200",
  stuck: "bg-destructive/10 text-destructive border-destructive/30",
};

export function LiveRecordingStateBadge({
  state,
}: {
  state: LiveRecordingState;
}) {
  const label = LIVE_RECORDING_STATE_LABELS[state] ?? state;
  return (
    <Badge variant="outline" className={cn("font-medium", COLORS[state])}>
      {state === "live" && "🔴 "}
      {label}
    </Badge>
  );
}
