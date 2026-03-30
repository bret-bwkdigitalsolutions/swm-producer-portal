"use client";

import { useActionState, useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { submitDistribution } from "./actions";
import { ShowSelect } from "@/components/forms/show-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PublishToggle, type PublishState } from "@/components/forms/publish-toggle";
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
  { key: "website", label: "Website", icon: GlobeIcon },
] as const;

export function DistributionForm({ shows }: { shows: Show[] }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    submitDistribution,
    {}
  );
  const formRef = useRef<HTMLFormElement>(null);
  const videoFileRef = useRef<File | null>(null);
  const [showId, setShowId] = useState("");
  const [publishState, setPublishState] = useState<PublishState>({ status: "publish" });
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [videoFileSize, setVideoFileSize] = useState<number>(0);
  const [videoContentType, setVideoContentType] = useState<string>("");
  const [thumbnailFileName, setThumbnailFileName] = useState<string | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // After job is created, upload video to GCS
  const uploadVideoToGCS = useCallback(async (jobId: string) => {
    const file = videoFileRef.current;
    if (!file) return;

    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    try {
      // 1. Get signed upload URL
      const signedUrlRes = await fetch("/api/upload/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          jobId,
        }),
      });

      if (!signedUrlRes.ok) {
        const err = await signedUrlRes.json();
        throw new Error(err.error ?? "Failed to get upload URL");
      }

      const { uploadUrl } = await signedUrlRes.json();

      // 2. Upload directly to GCS using XMLHttpRequest for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error("Upload failed — network error"));
        xhr.onabort = () => reject(new Error("Upload was cancelled"));

        xhr.send(file);
      });

      // 3. Mark job as ready for processing
      const confirmRes = await fetch(`/api/upload/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });

      if (!confirmRes.ok) {
        const err = await confirmRes.json();
        throw new Error(err.error ?? "Failed to confirm upload");
      }

      // Success — redirect to job detail page
      router.push(`/dashboard/distribute/${jobId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setUploadError(message);
      setUploading(false);
    }
  }, [router]);

  // Trigger upload after successful job creation
  useEffect(() => {
    if (state.success && state.jobId) {
      uploadVideoToGCS(state.jobId);
    }
  }, [state.success, state.jobId, uploadVideoToGCS]);

  const isDisabled = isPending || uploading;

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-lg">New Episode Distribution</CardTitle>
      </CardHeader>

      <form ref={formRef} action={formAction}>
        <CardContent className="space-y-6">
          {/* Upload progress */}
          {uploading && (
            <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3">
              <div className="flex items-center gap-2 text-sm text-blue-800">
                <Loader2Icon className="size-4 animate-spin" />
                Uploading video... {uploadProgress}%
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-blue-200">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Upload error */}
          {uploadError && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircleIcon className="size-4 shrink-0" />
              {uploadError}
            </div>
          )}

          {/* Success message (before upload starts) */}
          {state.success && state.message && !uploading && !uploadError && (
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

          {/* Video file select (not uploaded via form — stored in ref) */}
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
                type="file"
                accept="video/*"
                className="sr-only"
                disabled={isDisabled}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  videoFileRef.current = file;
                  setVideoFileName(file?.name ?? null);
                  setVideoFileSize(file?.size ?? 0);
                  setVideoContentType(file?.type ?? "");
                }}
              />
            </label>
          </div>

          {/* Hidden fields for video metadata (sent in FormData instead of the file) */}
          {videoFileName && (
            <>
              <input type="hidden" name="video_file_name" value={videoFileName} />
              <input type="hidden" name="video_file_size" value={videoFileSize.toString()} />
              <input type="hidden" name="video_content_type" value={videoContentType} />
            </>
          )}

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
              disabled={isDisabled}
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
              disabled={isDisabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              name="tags"
              placeholder="true crime, cold case, investigation (comma-separated)"
              disabled={isDisabled}
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
                disabled={isDisabled}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setThumbnailFileName(file?.name ?? null);
                }}
              />
            </label>
          </div>

          {/* Target platforms */}
          <fieldset className="space-y-3" disabled={isDisabled}>
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

          {/* Publish mode */}
          <PublishToggle value={publishState} onChange={setPublishState} />
        </CardContent>

        <CardFooter>
          <Button type="submit" disabled={isDisabled} size="lg" className="w-full">
            {isPending && <Loader2Icon className="size-4 animate-spin" />}
            {uploading
              ? "Uploading..."
              : isPending
                ? "Submitting..."
                : publishState.status === "draft"
                  ? "Save as Draft (Unlisted)"
                  : publishState.status === "future"
                    ? "Schedule Distribution"
                    : "Distribute Now"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
