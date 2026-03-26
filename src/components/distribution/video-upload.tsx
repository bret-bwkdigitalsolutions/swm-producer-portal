"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloudIcon, FileVideoIcon, XIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VideoUploadProps {
  jobId: string;
  onUploadComplete?: (gcsPath: string) => void;
  onUploadError?: (error: string) => void;
}

type UploadState =
  | { phase: "idle" }
  | { phase: "preparing" }
  | { phase: "uploading"; progress: number; startedAt: number }
  | { phase: "complete"; gcsPath: string }
  | { phase: "error"; message: string };

const ACCEPTED_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/webm",
  "video/mpeg",
  "video/x-ms-wmv",
];

// 5 MB chunk size for chunked uploads
const CHUNK_SIZE = 5 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}

function formatTimeRemaining(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "calculating...";
  if (seconds < 60) return `${Math.ceil(seconds)}s remaining`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `${mins}m ${secs}s remaining`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.ceil((seconds % 3600) / 60);
  return `${hours}h ${mins}m remaining`;
}

export function VideoUpload({
  jobId,
  onUploadComplete,
  onUploadError,
}: VideoUploadProps) {
  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const resetUpload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState({ phase: "idle" });
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const uploadFile = useCallback(
    async (selectedFile: File) => {
      setFile(selectedFile);
      setState({ phase: "preparing" });

      // Step 1: Get a signed URL from our API
      let uploadUrl: string;
      let gcsPath: string;

      try {
        const response = await fetch("/api/upload/signed-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: selectedFile.name,
            contentType: selectedFile.type,
            jobId,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(
            data.error || `Failed to get upload URL (${response.status})`
          );
        }

        const data = await response.json();
        uploadUrl = data.uploadUrl;
        gcsPath = data.gcsPath;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to prepare upload.";
        setState({ phase: "error", message });
        onUploadError?.(message);
        return;
      }

      // Step 2: Initiate resumable upload session with GCS
      let sessionUri: string;
      try {
        const initResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Type": selectedFile.type,
            "x-goog-resumable": "start",
          },
        });

        const location = initResponse.headers.get("Location");
        if (!location) {
          throw new Error("GCS did not return a resumable session URI.");
        }
        sessionUri = location;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to initiate resumable upload.";
        setState({ phase: "error", message });
        onUploadError?.(message);
        return;
      }

      // Step 3: Upload in chunks using XMLHttpRequest for progress tracking
      const startedAt = Date.now();
      setState({ phase: "uploading", progress: 0, startedAt });

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const totalSize = selectedFile.size;
        let uploadedBytes = 0;

        // For small files (< CHUNK_SIZE), upload in one shot
        if (totalSize <= CHUNK_SIZE) {
          await uploadWithProgress(
            sessionUri,
            selectedFile,
            0,
            totalSize - 1,
            totalSize,
            (loaded) => {
              const progress = (loaded / totalSize) * 100;
              setState({ phase: "uploading", progress, startedAt });
            },
            abortController.signal
          );
        } else {
          // Chunked upload for large files
          while (uploadedBytes < totalSize) {
            if (abortController.signal.aborted) {
              throw new Error("Upload cancelled.");
            }

            const start = uploadedBytes;
            const end = Math.min(start + CHUNK_SIZE, totalSize) - 1;
            const chunk = selectedFile.slice(start, end + 1);

            await uploadChunk(
              sessionUri,
              chunk,
              start,
              end,
              totalSize,
              selectedFile.type,
              abortController.signal
            );

            uploadedBytes = end + 1;
            const progress = (uploadedBytes / totalSize) * 100;
            setState({ phase: "uploading", progress, startedAt });
          }
        }

        setState({ phase: "complete", gcsPath });
        onUploadComplete?.(gcsPath);
      } catch (error) {
        if (abortController.signal.aborted) return;
        const message =
          error instanceof Error ? error.message : "Upload failed.";
        setState({ phase: "error", message });
        onUploadError?.(message);
      } finally {
        abortControllerRef.current = null;
      }
    },
    [jobId, onUploadComplete, onUploadError]
  );

  const retryUpload = useCallback(() => {
    if (file) {
      uploadFile(file);
    }
  }, [file, uploadFile]);

  const handleFileSelect = useCallback(
    (selectedFile: File) => {
      if (!ACCEPTED_TYPES.includes(selectedFile.type)) {
        setState({
          phase: "error",
          message: `Unsupported file type: ${selectedFile.type || "unknown"}. Please upload a video file (MP4, MOV, AVI, MKV, WebM).`,
        });
        return;
      }
      uploadFile(selectedFile);
    },
    [uploadFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        handleFileSelect(droppedFile);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
        handleFileSelect(selectedFile);
      }
    },
    [handleFileSelect]
  );

  // Idle / Drop zone
  if (state.phase === "idle") {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
        }`}
      >
        <UploadCloudIcon className="mb-4 size-12 text-muted-foreground" />
        <p className="mb-1 text-lg font-medium">
          Drop your video file here
        </p>
        <p className="mb-4 text-sm text-muted-foreground">
          or click to browse. Supports MP4, MOV, AVI, MKV, WebM.
        </p>
        <p className="text-xs text-muted-foreground">
          Multi-GB files supported via resumable upload.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleInputChange}
          className="hidden"
        />
      </div>
    );
  }

  // Preparing state
  if (state.phase === "preparing") {
    return (
      <div className="rounded-lg border p-6">
        <div className="flex items-center gap-3">
          <FileVideoIcon className="size-8 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{file?.name}</p>
            <p className="text-sm text-muted-foreground">
              {file ? formatBytes(file.size) : ""} — Preparing upload...
            </p>
          </div>
          <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  // Uploading state
  if (state.phase === "uploading") {
    const elapsed = (Date.now() - state.startedAt) / 1000;
    const bytesUploaded = file ? (state.progress / 100) * file.size : 0;
    const speed = elapsed > 0 ? bytesUploaded / elapsed : 0;
    const bytesRemaining = file ? file.size - bytesUploaded : 0;
    const timeRemaining = speed > 0 ? bytesRemaining / speed : Infinity;

    return (
      <div className="rounded-lg border p-6">
        <div className="mb-4 flex items-center gap-3">
          <FileVideoIcon className="size-8 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{file?.name}</p>
            <p className="text-sm text-muted-foreground">
              {file ? formatBytes(file.size) : ""} —{" "}
              {formatBytes(bytesUploaded)} uploaded
              {speed > 0 ? ` (${formatBytes(speed)}/s)` : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetUpload}
            title="Cancel upload"
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Progress bar */}
        <div className="mb-2 h-3 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${Math.min(state.progress, 100)}%` }}
          />
        </div>

        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{state.progress.toFixed(1)}%</span>
          <span>{formatTimeRemaining(timeRemaining)}</span>
        </div>
      </div>
    );
  }

  // Complete state
  if (state.phase === "complete") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6 dark:border-green-900/30 dark:bg-green-900/10">
        <div className="flex items-center gap-3">
          <FileVideoIcon className="size-8 text-green-600 dark:text-green-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{file?.name}</p>
            <p className="text-sm text-green-700 dark:text-green-300">
              {file ? formatBytes(file.size) : ""} — Upload complete
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={resetUpload}>
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900/30 dark:bg-red-900/10">
      <div className="mb-3 flex items-center gap-3">
        <FileVideoIcon className="size-8 text-red-600 dark:text-red-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{file?.name ?? "Upload"}</p>
          <p className="text-sm text-red-700 dark:text-red-300">
            {state.message}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        {file && (
          <Button variant="outline" size="sm" onClick={retryUpload}>
            <RefreshCwIcon className="mr-1.5 size-3.5" />
            Retry
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={resetUpload}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Upload a blob to a GCS resumable session URI using XMLHttpRequest
 * for progress tracking. Used for small files (single-shot upload).
 */
function uploadWithProgress(
  sessionUri: string,
  blob: Blob,
  rangeStart: number,
  rangeEnd: number,
  totalSize: number,
  onProgress: (loaded: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const abortHandler = () => {
      xhr.abort();
      reject(new Error("Upload cancelled."));
    };
    signal.addEventListener("abort", abortHandler, { once: true });

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(rangeStart + e.loaded);
      }
    });

    xhr.addEventListener("load", () => {
      signal.removeEventListener("abort", abortHandler);
      if (xhr.status >= 200 && xhr.status < 400) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      signal.removeEventListener("abort", abortHandler);
      reject(new Error("Network error during upload."));
    });

    xhr.open("PUT", sessionUri);
    xhr.setRequestHeader(
      "Content-Range",
      `bytes ${rangeStart}-${rangeEnd}/${totalSize}`
    );
    xhr.send(blob);
  });
}

/**
 * Upload a single chunk to a GCS resumable session URI.
 * Used for large files split into multiple chunks.
 */
function uploadChunk(
  sessionUri: string,
  chunk: Blob,
  rangeStart: number,
  rangeEnd: number,
  totalSize: number,
  contentType: string,
  signal: AbortSignal,
  retries = 3
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const abortHandler = () => {
      xhr.abort();
      reject(new Error("Upload cancelled."));
    };
    signal.addEventListener("abort", abortHandler, { once: true });

    xhr.addEventListener("load", () => {
      signal.removeEventListener("abort", abortHandler);
      // GCS returns 308 Resume Incomplete for intermediate chunks,
      // 200 or 201 for the final chunk
      if (
        xhr.status === 200 ||
        xhr.status === 201 ||
        xhr.status === 308
      ) {
        resolve();
      } else if (xhr.status >= 500 && retries > 0) {
        // Retry on server errors with exponential backoff
        const delay = (4 - retries) * 1000;
        setTimeout(() => {
          uploadChunk(
            sessionUri,
            chunk,
            rangeStart,
            rangeEnd,
            totalSize,
            contentType,
            signal,
            retries - 1
          )
            .then(resolve)
            .catch(reject);
        }, delay);
      } else {
        reject(
          new Error(`Chunk upload failed with status ${xhr.status}`)
        );
      }
    });

    xhr.addEventListener("error", () => {
      signal.removeEventListener("abort", abortHandler);
      if (retries > 0) {
        const delay = (4 - retries) * 1000;
        setTimeout(() => {
          uploadChunk(
            sessionUri,
            chunk,
            rangeStart,
            rangeEnd,
            totalSize,
            contentType,
            signal,
            retries - 1
          )
            .then(resolve)
            .catch(reject);
        }, delay);
      } else {
        reject(new Error("Network error during chunk upload."));
      }
    });

    xhr.open("PUT", sessionUri);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader(
      "Content-Range",
      `bytes ${rangeStart}-${rangeEnd}/${totalSize}`
    );
    xhr.send(chunk);
  });
}
