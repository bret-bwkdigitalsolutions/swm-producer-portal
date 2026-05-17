"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  UploadCloudIcon,
  XIcon,
  ImageIcon,
  CheckCircle2Icon,
  Loader2Icon,
  AlertCircleIcon,
  StarIcon,
} from "lucide-react";
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type GalleryItemState = "uploading" | "done" | "error";

export interface GalleryItem {
  // Stable client-side id so React keys don't reuse across reorders
  clientId: string;
  file: File;
  previewUrl: string;
  state: GalleryItemState;
  mediaId?: number;
  errorMessage?: string;
}

export interface UploaderHandle {
  /** Resolve the final ordered list of WP media IDs to send to the action,
   * plus optionally a hero ID (the cropped 16:9 variant). Returns null if
   * not all uploads are complete or the hero crop is missing/invalid. */
  resolve: () => Promise<
    | { galleryIds: number[]; heroId: number | null }
    | { error: string }
  >;
}

interface Props {
  uploaderRef: React.MutableRefObject<UploaderHandle | null>;
  uploadUrl?: string;
}

const HERO_ASPECT = 16 / 9;
const UPLOAD_URL_DEFAULT = "/api/upload/appearance-gallery";

export function AppearanceGalleryUploader({
  uploaderRef,
  uploadUrl = UPLOAD_URL_DEFAULT,
}: Props) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [featuredClientId, setFeaturedClientId] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const featuredItem =
    items.find((i) => i.clientId === featuredClientId) ?? null;

  // Revoke object URLs on unmount
  useEffect(() => {
    return () => {
      items.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    };
    // intentionally only on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadOne = useCallback(
    async (clientId: string, file: File) => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const resp = await fetch(uploadUrl, { method: "POST", body: fd });
        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
          throw new Error(
            errBody.error ?? `Upload failed (${resp.status})`
          );
        }
        const data = (await resp.json()) as { id: number };
        setItems((prev) =>
          prev.map((it) =>
            it.clientId === clientId
              ? { ...it, state: "done", mediaId: data.id }
              : it
          )
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Upload failed";
        setItems((prev) =>
          prev.map((it) =>
            it.clientId === clientId
              ? { ...it, state: "error", errorMessage: message }
              : it
          )
        );
      }
    },
    [uploadUrl]
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const candidates = Array.from(files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (candidates.length === 0) return;

      const newItems: GalleryItem[] = candidates.map((f) => ({
        clientId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
        state: "uploading",
      }));

      setItems((prev) => {
        const wasEmpty = prev.length === 0;
        const next = [...prev, ...newItems];
        // Auto-mark the first uploaded image as featured if none set yet
        if (wasEmpty && newItems[0]) {
          setFeaturedClientId(newItems[0].clientId);
        }
        return next;
      });

      // Fire uploads in parallel — each is its own /api request
      newItems.forEach((it) => uploadOne(it.clientId, it.file));
    },
    [uploadOne]
  );

  const removeItem = useCallback(
    (clientId: string) => {
      setItems((prev) => {
        const target = prev.find((it) => it.clientId === clientId);
        if (target) URL.revokeObjectURL(target.previewUrl);
        return prev.filter((it) => it.clientId !== clientId);
      });
      if (featuredClientId === clientId) {
        setFeaturedClientId(null);
        setCrop(undefined);
        setCompletedCrop(undefined);
      }
    },
    [featuredClientId]
  );

  const retryUpload = useCallback(
    (clientId: string) => {
      const it = items.find((i) => i.clientId === clientId);
      if (!it) return;
      setItems((prev) =>
        prev.map((p) =>
          p.clientId === clientId
            ? { ...p, state: "uploading", errorMessage: undefined }
            : p
        )
      );
      uploadOne(clientId, it.file);
    },
    [items, uploadOne]
  );

  const setFeatured = useCallback((clientId: string) => {
    setFeaturedClientId(clientId);
    setCrop(undefined);
    setCompletedCrop(undefined);
  }, []);

  // When featured image loads, initialize a centered 16:9 crop
  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = e.currentTarget;
      const initial = centerCrop(
        makeAspectCrop(
          { unit: "%", width: 90 },
          HERO_ASPECT,
          naturalWidth,
          naturalHeight
        ),
        naturalWidth,
        naturalHeight
      );
      setCrop(initial);
      // Also set a pixel-based completedCrop so submission works without
      // any manual drag.
      const px = makeAspectCrop(
        { unit: "px", width: naturalWidth * 0.9 },
        HERO_ASPECT,
        naturalWidth,
        naturalHeight
      );
      setCompletedCrop({
        unit: "px",
        x: (naturalWidth - px.width) / 2,
        y: (naturalHeight - px.height) / 2,
        width: px.width,
        height: px.height,
      });
    },
    []
  );

  // Imperative handle: server action calls this to get IDs + hero
  useEffect(() => {
    uploaderRef.current = {
      resolve: async () => {
        if (items.length === 0) {
          return { galleryIds: [], heroId: null };
        }

        // Wait briefly for any still-uploading items
        const stillUploading = items.some((it) => it.state === "uploading");
        if (stillUploading) {
          return {
            error:
              "One or more images are still uploading. Please wait a moment, then try again.",
          };
        }

        const failed = items.filter((it) => it.state === "error");
        if (failed.length > 0) {
          return {
            error: `${failed.length} image upload(s) failed. Remove or retry them before submitting.`,
          };
        }

        const orderedIds = items
          .map((it) => it.mediaId)
          .filter((id): id is number => typeof id === "number");

        // If a featured image is selected AND has a valid crop, generate +
        // upload the cropped hero variant.
        let heroId: number | null = null;
        if (featuredItem && featuredItem.mediaId && completedCrop && imgRef.current) {
          const blob = await cropImageToBlob(
            imgRef.current,
            completedCrop
          );
          if (blob) {
            const heroFile = new File(
              [blob],
              `hero-${featuredItem.file.name.replace(/\.[^.]+$/, "")}.jpg`,
              { type: "image/jpeg" }
            );
            const fd = new FormData();
            fd.append("file", heroFile);
            const resp = await fetch(uploadUrl, {
              method: "POST",
              body: fd,
            });
            if (resp.ok) {
              const data = (await resp.json()) as { id: number };
              heroId = data.id;
            } else {
              const errBody = await resp.json().catch(() => ({}));
              return {
                error: `Hero crop upload failed: ${errBody.error ?? resp.status}`,
              };
            }
          }
        }

        // Append the hero ID LAST so the WP theme picks it as the hero
        // background-image (the theme reads the final gallery entry).
        const finalIds = heroId
          ? [...orderedIds, heroId]
          : orderedIds;

        return { galleryIds: finalIds, heroId };
      },
    };
  }, [items, featuredItem, completedCrop, uploadUrl, uploaderRef]);

  return (
    <div className="space-y-3">
      <Label>Gallery</Label>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
        }}
        onClick={() => galleryInputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
          dragActive
            ? "border-ring bg-accent"
            : "border-input hover:border-ring/50 hover:bg-muted/50"
        )}
      >
        <UploadCloudIcon className="size-8 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">
            Drop images here or click to browse
          </p>
          <p className="text-xs text-muted-foreground">
            PNG, JPG, WebP, HEIC — uploads start immediately
          </p>
        </div>
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
          className="hidden"
        />
      </div>

      {/* Item grid */}
      {items.length === 0 ? (
        <div className="flex size-20 items-center justify-center rounded-lg border border-dashed border-border">
          <ImageIcon className="size-6 text-muted-foreground" />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((it) => {
            const isFeatured = it.clientId === featuredClientId;
            return (
              <div key={it.clientId} className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={it.previewUrl}
                  alt={it.file.name}
                  className={cn(
                    "size-20 rounded-lg border object-cover",
                    isFeatured
                      ? "border-amber-400 ring-2 ring-amber-400/40"
                      : "border-border"
                  )}
                />
                {/* Upload state overlay */}
                {it.state === "uploading" && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                    <Loader2Icon className="size-5 animate-spin text-white" />
                  </div>
                )}
                {it.state === "error" && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      retryUpload(it.clientId);
                    }}
                    className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-destructive/80 text-[10px] text-destructive-foreground"
                    title={it.errorMessage ?? "Click to retry"}
                  >
                    <AlertCircleIcon className="size-5" />
                    <span>Retry</span>
                  </button>
                )}
                {it.state === "done" && (
                  <CheckCircle2Icon className="absolute bottom-1 left-1 size-4 rounded-full bg-white text-green-600" />
                )}
                {/* Set-as-featured star */}
                {it.state === "done" && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFeatured(it.clientId);
                    }}
                    className={cn(
                      "absolute -left-1.5 -top-1.5 inline-flex size-5 items-center justify-center rounded-full shadow-sm",
                      isFeatured
                        ? "bg-amber-400 text-white"
                        : "bg-white text-muted-foreground hover:text-amber-500"
                    )}
                    title={
                      isFeatured ? "Featured image" : "Set as featured image"
                    }
                  >
                    <StarIcon className="size-3" />
                  </button>
                )}
                {/* Remove */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeItem(it.clientId);
                  }}
                  className="absolute -right-1.5 -top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/80"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Hero crop */}
      {featuredItem && featuredItem.state === "done" && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Featured image — crop hero</p>
              <p className="text-xs text-muted-foreground">
                Drag the box to frame the subject. Locked to 16:9 for the hero
                banner. Original stays untouched in the gallery.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFeaturedClientId(null);
                setCrop(undefined);
                setCompletedCrop(undefined);
              }}
            >
              Clear featured
            </Button>
          </div>
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}
            aspect={HERO_ASPECT}
            keepSelection
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={featuredItem.previewUrl}
              onLoad={onImageLoad}
              alt="Featured image crop preview"
              className="max-h-96 w-auto"
            />
          </ReactCrop>
        </div>
      )}
    </div>
  );
}

async function cropImageToBlob(
  image: HTMLImageElement,
  crop: PixelCrop
): Promise<Blob | null> {
  // ReactCrop's pixel coordinates are in DISPLAYED image space. Convert to
  // natural-resolution coordinates so the output crop is full-resolution.
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  const sx = Math.round(crop.x * scaleX);
  const sy = Math.round(crop.y * scaleY);
  const sw = Math.round(crop.width * scaleX);
  const sh = Math.round(crop.height * scaleY);
  if (sw <= 0 || sh <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.9);
  });
}
