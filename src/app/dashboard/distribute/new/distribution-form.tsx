"use client";

import {
  useActionState,
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { useRouter } from "next/navigation";
import { submitDistribution, updateDistribution } from "./actions";
import { ShowSelect } from "@/components/forms/show-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PublishToggle,
  type PublishState,
} from "@/components/forms/publish-toggle";
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
  PenLineIcon,
  SparklesIcon,
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

interface AiSuggestion {
  id: string;
  type: "chapters" | "summary" | "blog";
  content: string;
  accepted: boolean;
}

type DescriptionMode = "manual" | "ai" | null;

const PLATFORMS = [
  { key: "youtube", label: "YouTube", icon: MonitorPlayIcon, comingSoon: false, hint: "" },
  { key: "transistor", label: "Transistor", icon: CastIcon, comingSoon: false, hint: "Distributes audio to Apple Podcasts, Spotify & 20+ platforms" },
  { key: "website", label: "Website", icon: GlobeIcon, comingSoon: false, hint: "" },
  { key: "spotify", label: "Spotify Video", icon: RadioIcon, comingSoon: true, hint: "" },
  { key: "apple", label: "Apple Video", icon: HeadphonesIcon, comingSoon: true, hint: "" },
] as const;

const CHUNK_SIZE = 16 * 1024 * 1024; // 16MB
const MAX_RETRIES = 5;

export function DistributionForm({ shows }: { shows: Show[] }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    submitDistribution,
    {}
  );
  const formRef = useRef<HTMLFormElement>(null);
  const videoFileRef = useRef<File | null>(null);
  const [showId, setShowId] = useState("");
  const [title, setTitle] = useState("");
  const [publishState, setPublishState] = useState<PublishState>({
    status: "publish",
  });
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [videoFileSize, setVideoFileSize] = useState<number>(0);
  const [videoContentType, setVideoContentType] = useState<string>("");
  const [thumbnailFileName, setThumbnailFileName] = useState<string | null>(
    null
  );
  const thumbnailFileRef = useRef<File | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Two-path description state
  const [descriptionMode, setDescriptionMode] = useState<DescriptionMode>(null);
  const [description, setDescription] = useState("");
  const [chapters, setChapters] = useState("");

  // AI analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState("");
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Track whether upload was done for AI path (video uploaded before form submit)
  const [aiUploadedJobId, setAiUploadedJobId] = useState<string | null>(null);

  /**
   * Upload thumbnail to GCS via a simple PUT (images are small).
   */
  const uploadThumbnailToGCS = useCallback(async (jobId: string) => {
    const file = thumbnailFileRef.current;
    if (!file) return;

    const signedUrlRes = await fetch("/api/upload/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        jobId,
        purpose: "thumbnail",
      }),
    });

    if (!signedUrlRes.ok) {
      const err = await signedUrlRes.json();
      console.error("[thumbnail] Failed to get upload URL:", err.error);
      return; // Non-fatal — proceed without thumbnail
    }

    const { uploadUrl } = await signedUrlRes.json();

    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });

    if (!uploadRes.ok) {
      console.error("[thumbnail] Upload failed:", uploadRes.status);
    }
  }, []);

  /**
   * Upload video to GCS via resumable upload. Returns when upload is complete.
   * Does NOT call /api/upload/confirm — caller decides what to do next.
   */
  const uploadVideoToGCS = useCallback(async (jobId: string) => {
    const file = videoFileRef.current;
    if (!file) throw new Error("No video file selected");

    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

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

    // 2. Initiate resumable upload session
    const sessionUri = await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.setRequestHeader("x-goog-resumable", "start");
      xhr.setRequestHeader("Content-Length", "0");

      xhr.onload = () => {
        const location = xhr.getResponseHeader("Location");
        if (xhr.status === 201 && location) {
          resolve(location);
        } else {
          reject(
            new Error(
              `Failed to initiate upload session (status ${xhr.status})`
            )
          );
        }
      };
      xhr.onerror = () =>
        reject(new Error("Network error initiating upload session"));
      xhr.send();
    });

    // 3. Upload chunks
    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK_SIZE, file.size);
      const chunk = file.slice(offset, end);
      const contentRange = `bytes ${offset}-${end - 1}/${file.size}`;

      let success = false;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const status = await new Promise<number>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", sessionUri);
            xhr.setRequestHeader("Content-Range", contentRange);
            xhr.onload = () => resolve(xhr.status);
            xhr.onerror = () =>
              reject(new Error("Network error during chunk upload"));
            xhr.onabort = () => reject(new Error("Upload was cancelled"));
            xhr.send(chunk);
          });

          if (status === 308 || (status >= 200 && status < 300)) {
            success = true;
            break;
          }
          if (status >= 500) {
            await new Promise((r) =>
              setTimeout(r, Math.pow(2, attempt) * 1000)
            );
            continue;
          }
          throw new Error(`Upload failed with status ${status}`);
        } catch (error) {
          if (attempt === MAX_RETRIES - 1) throw error;
          await new Promise((r) =>
            setTimeout(r, Math.pow(2, attempt) * 1000)
          );
        }
      }

      if (!success) {
        throw new Error("Upload failed after maximum retries");
      }

      offset = end;
      setUploadProgress(Math.round((offset / file.size) * 100));
    }

    setUploading(false);
  }, []);

  /**
   * AI path: create job -> upload video -> analyze -> show suggestions
   */
  const startAiAnalysis = useCallback(async () => {
    // We need a job first. Submit the form data programmatically
    // to create the job, then upload + analyze.
    if (!formRef.current) return;

    setAnalyzing(true);
    setAnalysisError(null);
    setSuggestions([]);
    setAnalysisStep("Creating job...");

    try {
      // Build FormData from current state for job creation
      const fd = new FormData();
      fd.set("show_id", showId);
      fd.set("title", title);
      fd.set("description", "AI-generated description pending");
      fd.set("video_file_name", videoFileName ?? "");
      fd.set("video_file_size", videoFileSize.toString());
      fd.set("video_content_type", videoContentType);
      // Need at least one platform for validation - use youtube as placeholder
      // The actual platforms will be set when the form is submitted for real
      fd.set("platform_youtube", "on");
      if (publishState.status === "draft") fd.set("status", "draft");

      // Create the job via server action
      const result = await submitDistribution({}, fd);
      if (!result.success || !result.jobId) {
        throw new Error(result.message ?? "Failed to create job");
      }

      const jobId = result.jobId;
      setAiUploadedJobId(jobId);

      // Upload video and thumbnail
      setAnalysisStep("Uploading video...");
      await Promise.all([
        uploadVideoToGCS(jobId),
        uploadThumbnailToGCS(jobId),
      ]);

      // Mark upload complete (sets gcsPath on server)
      setAnalysisStep("Extracting audio...");
      const confirmRes = await fetch("/api/upload/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, skipProcessing: true }),
      });
      if (!confirmRes.ok) {
        const err = await confirmRes.json();
        throw new Error(err.error ?? "Failed to confirm upload");
      }

      // Run AI analysis
      setAnalysisStep("Transcribing... this may take a few minutes");
      const analyzeRes = await fetch("/api/distribute/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });

      if (!analyzeRes.ok) {
        const err = await analyzeRes.json();
        throw new Error(err.error ?? "Analysis failed");
      }

      setAnalysisStep("Generating recommendations...");
      const data = await analyzeRes.json();
      const aiSuggestions: AiSuggestion[] = data.suggestions ?? [];
      setSuggestions(aiSuggestions);

      // Pre-populate description and chapters from suggestions
      const summarySuggestion = aiSuggestions.find((s) => s.type === "summary");
      if (summarySuggestion) {
        setDescription(summarySuggestion.content);
      }
      const chaptersSuggestion = aiSuggestions.find(
        (s) => s.type === "chapters"
      );
      if (chaptersSuggestion) {
        setChapters(chaptersSuggestion.content);
      }

      setAnalysisStep("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Analysis failed";
      setAnalysisError(message);
      setAnalysisStep("");
    } finally {
      setAnalyzing(false);
      setUploading(false);
    }
  }, [
    showId,
    title,
    videoFileName,
    videoFileSize,
    videoContentType,
    publishState.status,
    uploadVideoToGCS,
    uploadThumbnailToGCS,
  ]);

  /**
   * Manual path: after form submission creates a job, upload + confirm + redirect
   */
  const uploadAndConfirmManual = useCallback(
    async (jobId: string) => {
      try {
        await Promise.all([
          uploadVideoToGCS(jobId),
          uploadThumbnailToGCS(jobId),
        ]);

        const confirmRes = await fetch("/api/upload/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
        if (!confirmRes.ok) {
          const err = await confirmRes.json();
          throw new Error(err.error ?? "Failed to confirm upload");
        }

        router.push(`/dashboard/distribute/${jobId}`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Upload failed";
        setUploadError(message);
        setUploading(false);
      }
    },
    [uploadVideoToGCS, uploadThumbnailToGCS, router]
  );

  /**
   * AI path: after review, user clicks distribute.
   * The job already exists and video is uploaded. Update metadata/platforms, then confirm.
   */
  const distributeAfterAi = useCallback(async () => {
    if (!aiUploadedJobId || !formRef.current) return;

    setUploading(true);
    setUploadError(null);

    try {
      // Collect selected platforms from the form checkboxes
      const fd = new FormData(formRef.current);
      const selectedPlatforms = PLATFORMS
        .map((p) => p.key)
        .filter((key) => fd.get(`platform_${key}`) === "on");

      if (selectedPlatforms.length === 0) {
        throw new Error("Please select at least one target platform.");
      }

      // Collect tags
      const tagsRaw = fd.get("tags") as string | null;
      const tags = tagsRaw
        ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
        : [];

      // Update job with final description, chapters, platforms
      const updateResult = await updateDistribution(aiUploadedJobId, {
        description: description.trim(),
        chapters: chapters.trim() || undefined,
        tags,
        platforms: selectedPlatforms,
        isDraft: publishState.status === "draft",
        scheduleMode: publishState.status === "future" ? "schedule" : "now",
        scheduledAt: publishState.status === "future" ? publishState.date ?? null : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      if (!updateResult.success) {
        throw new Error(updateResult.message ?? "Failed to update job");
      }

      // Now confirm to trigger processing
      const confirmRes = await fetch("/api/upload/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: aiUploadedJobId }),
      });
      if (!confirmRes.ok) {
        const err = await confirmRes.json();
        throw new Error(err.error ?? "Failed to start distribution");
      }

      router.push(`/dashboard/distribute/${aiUploadedJobId}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Distribution failed";
      setUploadError(message);
      setUploading(false);
    }
  }, [aiUploadedJobId, description, chapters, publishState, router]);

  // Trigger upload after successful manual-path job creation
  useEffect(() => {
    if (
      state.success &&
      state.jobId &&
      descriptionMode === "manual" &&
      !aiUploadedJobId
    ) {
      uploadAndConfirmManual(state.jobId);
    }
  }, [
    state.success,
    state.jobId,
    descriptionMode,
    aiUploadedJobId,
    uploadAndConfirmManual,
  ]);

  const isDisabled = isPending || uploading || analyzing;
  const showModeChoice = !!videoFileName && title.trim().length > 0 && !descriptionMode;

  const aiReady = descriptionMode === "ai" && suggestions.length > 0 && !analyzing;

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-lg">New Episode Distribution</CardTitle>
      </CardHeader>

      <form
        ref={formRef}
        action={formAction}
        onSubmit={(e) => {
          // For AI path, prevent default form submission and handle manually
          if (descriptionMode === "ai" && aiUploadedJobId) {
            e.preventDefault();
            distributeAfterAi();
          }
        }}
      >
        <CardContent className="space-y-6">
          {/* Upload progress */}
          {uploading && (
            <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3">
              <div className="flex items-center gap-2 text-sm text-blue-800">
                <Loader2Icon className="size-4 animate-spin" />
                {analysisStep || `Uploading video... ${uploadProgress}%`}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-blue-200">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* AI analysis progress (not during upload phase) */}
          {analyzing && !uploading && (
            <div className="space-y-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-3">
              <div className="flex items-center gap-2 text-sm text-purple-800">
                <Loader2Icon className="size-4 animate-spin" />
                {analysisStep}
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

          {/* Analysis error */}
          {analysisError && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircleIcon className="size-4 shrink-0" />
              {analysisError}
            </div>
          )}

          {/* Success message (manual path, before upload starts) */}
          {state.success &&
            state.message &&
            !uploading &&
            !uploadError &&
            descriptionMode === "manual" && (
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

          {/* Video file select */}
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
                  // Reset mode if video changes
                  setDescriptionMode(null);
                  setSuggestions([]);
                  setAiUploadedJobId(null);
                }}
              />
            </label>
          </div>

          {/* Hidden fields for video metadata */}
          {videoFileName && (
            <>
              <input type="hidden" name="video_file_name" value={videoFileName} />
              <input
                type="hidden"
                name="video_file_size"
                value={videoFileSize.toString()}
              />
              <input
                type="hidden"
                name="video_content_type"
                value={videoContentType}
              />
            </>
          )}

          {/* Episode title */}
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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Season & Episode numbers */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="season_number">Season Number</Label>
              <Input
                id="season_number"
                name="season_number"
                type="number"
                min={1}
                placeholder="Optional"
                disabled={isDisabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="episode_number">Episode Number</Label>
              <Input
                id="episode_number"
                name="episode_number"
                type="number"
                min={1}
                placeholder="Optional"
                disabled={isDisabled}
              />
            </div>
          </div>

          {/* Content warning */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="explicit"
              name="explicit"
              value="true"
              className="rounded border-gray-300"
            />
            <Label htmlFor="explicit" className="cursor-pointer text-sm">
              Contains explicit/mature content
            </Label>
          </div>

          {/* Two-path choice: appears after video + title are provided */}
          {showModeChoice && (
            <div className="space-y-3">
              <Label>How would you like to write your description?</Label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setDescriptionMode("manual")}
                  className="flex flex-col items-center gap-2 rounded-lg border-2 border-input px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
                >
                  <PenLineIcon className="size-6 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    I&apos;ll write my own description
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Enter your description manually
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDescriptionMode("ai");
                    startAiAnalysis();
                  }}
                  className="flex flex-col items-center gap-2 rounded-lg border-2 border-input px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-primary/5"
                >
                  <SparklesIcon className="size-6 text-primary" />
                  <span className="text-sm font-medium">
                    Get AI recommendations
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Upload video first, then get AI-generated suggestions
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Manual description textarea */}
          {descriptionMode === "manual" && (
            <div className="space-y-2">
              <Label htmlFor="description">
                Description <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="description"
                placeholder="Episode description for podcast platforms..."
                rows={5}
                disabled={isDisabled}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          )}

          {/* AI suggestions review */}
          {descriptionMode === "ai" && suggestions.length > 0 && (
            <div className="space-y-4">
              {/* Summary / Description */}
              <div className="space-y-2">
                <Label htmlFor="ai-description">
                  Episode Description{" "}
                  <span className="text-xs text-muted-foreground">
                    (AI-generated, edit as needed)
                  </span>
                </Label>
                <Textarea
                  id="ai-description"
                  rows={6}
                  disabled={isDisabled}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {/* Chapters */}
              {chapters && (
                <div className="space-y-2">
                  <Label htmlFor="ai-chapters">
                    Chapters{" "}
                    <span className="text-xs text-muted-foreground">
                      (edit as needed)
                    </span>
                  </Label>
                  <Textarea
                    id="ai-chapters"
                    rows={8}
                    disabled={isDisabled}
                    value={chapters}
                    onChange={(e) => setChapters(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
              )}

              {/* Blog ideas are generated but only visible to admins in Admin > Blog Ideas */}
            </div>
          )}

          {/* Hidden description input for form submission */}
          <input type="hidden" name="description" value={description} />

          {/* Tags */}
          {descriptionMode && (
            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                name="tags"
                placeholder="true crime, cold case, investigation (comma-separated)"
                disabled={isDisabled}
              />
            </div>
          )}

          {/* Thumbnail upload */}
          {descriptionMode && (
            <div className="space-y-2">
              <Label htmlFor="thumbnail">Thumbnail</Label>
              <label
                htmlFor="thumbnail"
                className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
              >
                <UploadIcon className="size-6 text-muted-foreground" />
                {thumbnailFileName ? (
                  <span className="text-sm font-medium">
                    {thumbnailFileName}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Upload episode thumbnail image
                  </span>
                )}
                <input
                  id="thumbnail"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={isDisabled}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    thumbnailFileRef.current = file;
                    setThumbnailFileName(file?.name ?? null);
                  }}
                />
              </label>
            </div>
          )}

          {/* Target platforms — shown for manual path always, AI path after suggestions */}
          {(descriptionMode === "manual" || aiReady) && (
            <fieldset className="space-y-3" disabled={isDisabled}>
              <legend className="text-sm font-medium">
                Target Platforms <span className="text-destructive">*</span>
              </legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {PLATFORMS.map(({ key, label, icon: Icon, comingSoon, hint }) => (
                  <label
                    key={key}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors ${
                      comingSoon
                        ? "cursor-not-allowed opacity-50"
                        : "cursor-pointer has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5 hover:bg-muted/50"
                    }`}
                  >
                    <Checkbox name={`platform_${key}`} disabled={comingSoon} />
                    <Icon className="size-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <span className="text-sm">{label}</span>
                      {comingSoon && (
                        <span className="ml-1.5 text-xs text-muted-foreground">(Coming soon)</span>
                      )}
                      {hint && (
                        <p className="text-xs leading-tight text-muted-foreground">{hint}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {/* Publish mode */}
          {(descriptionMode === "manual" || aiReady) && (
            <PublishToggle value={publishState} onChange={setPublishState} />
          )}
        </CardContent>

        {/* Submit button — shown only after description mode is chosen */}
        {(descriptionMode === "manual" || aiReady) && (
          <CardFooter>
            <Button
              type="submit"
              disabled={isDisabled || !description.trim()}
              size="lg"
              className="w-full"
            >
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
        )}
      </form>
    </Card>
  );
}
