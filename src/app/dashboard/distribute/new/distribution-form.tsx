"use client";

import { useActionState, useState, useRef, useEffect } from "react";
import { submitDistribution } from "./actions";
import { ShowSelect } from "@/components/forms/show-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Loader2Icon,
  CheckCircle2Icon,
  AlertCircleIcon,
  UploadIcon,
  MonitorPlayIcon,
  RadioIcon,
  HeadphonesIcon,
  CastIcon,
  MicIcon,
  CrownIcon,
  GlobeIcon,
} from "lucide-react";

interface Show {
  id: string;
  title: string;
}

interface FormState {
  success?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
  jobId?: string;
}

const PLATFORMS = [
  { key: "youtube", label: "YouTube", icon: MonitorPlayIcon },
  { key: "spotify", label: "Spotify", icon: RadioIcon },
  { key: "apple", label: "Apple Podcasts", icon: HeadphonesIcon },
  { key: "transistor", label: "Transistor", icon: CastIcon },
  { key: "podbean", label: "Podbean", icon: MicIcon },
  { key: "patreon", label: "Patreon", icon: CrownIcon },
  { key: "website", label: "Website", icon: GlobeIcon },
] as const;

export function DistributionForm({ shows }: { shows: Show[] }) {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    submitDistribution,
    {}
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [showId, setShowId] = useState("");
  const [isScheduled, setIsScheduled] = useState(false);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [thumbnailFileName, setThumbnailFileName] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      setShowId("");
      setIsScheduled(false);
      setVideoFileName(null);
      setThumbnailFileName(null);
    }
  }, [state.success]);

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-lg">New Episode Distribution</CardTitle>
      </CardHeader>

      <form ref={formRef} action={formAction}>
        <CardContent className="space-y-6">
          {/* Success message */}
          {state.success && state.message && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800/50 dark:bg-green-950/30 dark:text-green-300">
              <CheckCircle2Icon className="size-4 shrink-0" />
              {state.message}
            </div>
          )}

          {/* Error message */}
          {state.success === false && state.message && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircleIcon className="size-4 shrink-0" />
              {state.message}
            </div>
          )}

          {/* Field-level errors */}
          {state.errors && Object.keys(state.errors).length > 0 && (
            <div className="space-y-1 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
              {Object.entries(state.errors).map(([field, messages]) =>
                messages.map((msg, i) => (
                  <p key={`${field}-${i}`} className="text-sm text-destructive">
                    <span className="font-medium capitalize">
                      {field.replace(/_/g, " ")}
                    </span>
                    : {msg}
                  </p>
                ))
              )}
            </div>
          )}

          {/* Show select */}
          <ShowSelect
            allowedShows={shows}
            value={showId}
            onValueChange={setShowId}
          />

          {/* Video file upload */}
          <div className="space-y-2">
            <Label htmlFor="video_file">
              Video File <span className="text-destructive">*</span>
            </Label>
            <label
              htmlFor="video_file"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
            >
              <UploadIcon className="size-8 text-muted-foreground" />
              {videoFileName ? (
                <span className="text-sm font-medium">{videoFileName}</span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Click to upload or drag and drop a video file
                </span>
              )}
              <input
                id="video_file"
                name="video_file"
                type="file"
                accept="video/*"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setVideoFileName(file?.name ?? null);
                }}
              />
            </label>
          </div>

          {/* Episode metadata */}
          <div className="space-y-2">
            <Label htmlFor="title">
              Episode Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              name="title"
              placeholder="e.g., Episode 42: The Cold Case"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="description"
              name="description"
              placeholder="Episode description for podcast platforms..."
              rows={5}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              name="tags"
              placeholder="true crime, cold case, investigation (comma-separated)"
            />
          </div>

          {/* Thumbnail upload */}
          <div className="space-y-2">
            <Label htmlFor="thumbnail">Thumbnail</Label>
            <label
              htmlFor="thumbnail"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
            >
              <UploadIcon className="size-6 text-muted-foreground" />
              {thumbnailFileName ? (
                <span className="text-sm font-medium">{thumbnailFileName}</span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Upload episode thumbnail image
                </span>
              )}
              <input
                id="thumbnail"
                name="thumbnail"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setThumbnailFileName(file?.name ?? null);
                }}
              />
            </label>
          </div>

          {/* Target platforms */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              Target Platforms <span className="text-destructive">*</span>
            </legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {PLATFORMS.map(({ key, label, icon: Icon }) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5 hover:bg-muted/50"
                >
                  <Checkbox name={`platform_${key}`} />
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Schedule toggle */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Switch
                checked={isScheduled}
                onCheckedChange={setIsScheduled}
                id="schedule_toggle"
              />
              <Label htmlFor="schedule_toggle" className="cursor-pointer">
                Schedule for later
              </Label>
            </div>
            <input
              type="hidden"
              name="schedule_mode"
              value={isScheduled ? "schedule" : "now"}
            />
            {isScheduled && (
              <div className="space-y-2">
                <Label htmlFor="scheduled_at">Scheduled Date &amp; Time</Label>
                <Input
                  id="scheduled_at"
                  name="scheduled_at"
                  type="datetime-local"
                  required={isScheduled}
                />
              </div>
            )}
          </div>
        </CardContent>

        <CardFooter>
          <Button type="submit" disabled={isPending} size="lg" className="w-full">
            {isPending && <Loader2Icon className="size-4 animate-spin" />}
            {isPending
              ? "Submitting..."
              : isScheduled
                ? "Schedule Distribution"
                : "Distribute Now"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
