"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function detectTimezone(): string {
  if (typeof Intl === "undefined") return "";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createLiveRecording } from "@/app/dashboard/live-recordings/new/actions";

interface Show {
  id: string;
  title: string;
}

interface LiveRecordingFormProps {
  allowedShows: Show[];
}

export function LiveRecordingForm({ allowedShows }: LiveRecordingFormProps) {
  const router = useRouter();
  const [wpShowId, setWpShowId] = useState("");
  const [timezone] = useState(detectTimezone);

  const [state, action, isPending] = useActionState(createLiveRecording, {});

  // Navigate to detail view on success
  useEffect(() => {
    if (state?.success && state.liveRecordingId) {
      const id = state.liveRecordingId;
      const t = setTimeout(() => {
        router.push(`/dashboard/live-recordings/${id}`);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [state?.success, state?.liveRecordingId, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule a live recording</CardTitle>
        <p className="text-sm text-muted-foreground">
          Enter the YouTube URL that Vimeo Live is simulcasting to. The portal
          publishes a placeholder episode page on the website immediately, then
          monitors the broadcast and runs the full transcription/blog pipeline
          once the recording archives.
        </p>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="wpShowId">
                Show <span className="text-destructive">*</span>
              </Label>
              <Select
                value={wpShowId}
                onValueChange={(v) => setWpShowId(v ?? "")}
                disabled={isPending}
              >
                <SelectTrigger id="wpShowId">
                  <SelectValue placeholder="Pick a show" />
                </SelectTrigger>
                <SelectContent>
                  {allowedShows.map((show) => (
                    <SelectItem key={show.id} value={show.id}>
                      {show.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="wpShowId" value={wpShowId} />
              {state?.errors?.wpShowId && (
                <p className="text-xs text-destructive">
                  {state.errors.wpShowId[0]}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="scheduledStartAt">
                Scheduled start <span className="text-destructive">*</span>
              </Label>
              <Input
                id="scheduledStartAt"
                name="scheduledStartAt"
                type="datetime-local"
                required
                disabled={isPending}
              />
              <input type="hidden" name="timezone" value={timezone} />
              {state?.errors?.scheduledStartAt && (
                <p className="text-xs text-destructive">
                  {state.errors.scheduledStartAt[0]}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="youtubeLiveUrl">
              YouTube live URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="youtubeLiveUrl"
              name="youtubeLiveUrl"
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              required
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Accepts watch URLs, youtu.be short links, and /live/ URLs.
            </p>
            {state?.errors?.youtubeLiveUrl && (
              <p className="text-xs text-destructive">
                {state.errors.youtubeLiveUrl[0]}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              name="title"
              placeholder="Episode title — appears on the WP post"
              required
              disabled={isPending}
            />
            {state?.errors?.title && (
              <p className="text-xs text-destructive">
                {state.errors.title[0]}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              Description{" "}
              <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              placeholder="Brief description shown on the scheduled-state page."
              disabled={isPending}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Scheduling…" : "Schedule Recording"}
            </Button>
            {state?.message && (
              <span
                className={
                  state.success
                    ? "text-sm text-green-600"
                    : "text-sm text-destructive"
                }
              >
                {state.message}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
