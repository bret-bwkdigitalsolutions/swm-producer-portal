"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  cancelLiveRecording,
  retryStuckLiveRecording,
  forceArchiveLiveRecording,
} from "./actions";
import type { LiveRecordingState } from "@/lib/live-recording/types";

interface Props {
  liveRecordingId: string;
  state: LiveRecordingState;
}

export function LiveRecordingAdminActions({ liveRecordingId, state }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    text: string;
    success: boolean;
  } | null>(null);

  const canCancel = state !== "archived" && state !== "cancelled";
  const canRetry = state === "stuck";
  const canForceArchive = state === "stuck" || state === "ended_pending";

  function run(label: string, action: () => Promise<{ success?: boolean; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({
        text: result.message ?? (result.success ? `${label} succeeded.` : `${label} failed.`),
        success: !!result.success,
      });
      if (result.success) router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canCancel && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (!confirm("Cancel this recording? The WP post will be unpublished. Snapshots and history are preserved.")) return;
              run("Cancel", () => cancelLiveRecording(liveRecordingId));
            }}
          >
            Cancel recording
          </Button>
        )}
        {canRetry && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run("Retry", () => retryStuckLiveRecording(liveRecordingId))}
          >
            Retry handoff
          </Button>
        )}
        {canForceArchive && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (!confirm("Force archive bypasses the YouTube download / Transistor upload. Only use this if you've handled those manually outside the portal.")) return;
              run("Force archive", () => forceArchiveLiveRecording(liveRecordingId));
            }}
          >
            Force archive
          </Button>
        )}
      </div>
      {message && (
        <p className={message.success ? "text-sm text-green-600" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
