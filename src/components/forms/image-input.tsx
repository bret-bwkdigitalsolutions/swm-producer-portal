"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageIcon, UploadCloudIcon, XIcon } from "lucide-react";

type ImageValue = File | string | null;

interface ImageInputProps {
  name: string;
  label: string;
  value: ImageValue;
  onChange: (value: ImageValue) => void;
  className?: string;
}

export function ImageInput({
  name,
  label,
  value,
  onChange,
  className,
}: ImageInputProps) {
  const [mode, setMode] = useState<"upload" | "url">(
    typeof value === "string" && value ? "url" : "upload"
  );
  const [urlInput, setUrlInput] = useState(
    typeof value === "string" ? value : ""
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate preview URL from value
  useEffect(() => {
    if (value instanceof File) {
      const url = URL.createObjectURL(value);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } else if (typeof value === "string" && value) {
      setPreviewUrl(value);
    } else {
      setPreviewUrl(null);
    }
  }, [value]);

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith("image/")) {
        onChange(file);
        setMode("upload");
      }
    },
    [onChange]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onChange(file);
      }
    },
    [onChange]
  );

  const handleUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const url = e.target.value;
      setUrlInput(url);
      if (url) {
        onChange(url);
      } else {
        onChange(null);
      }
    },
    [onChange]
  );

  const handleClear = useCallback(() => {
    onChange(null);
    setUrlInput("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [onChange]);

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={name}>{label}</Label>

      {/* Mode toggle */}
      <div className="flex gap-1 rounded-lg bg-muted p-0.5">
        <button
          type="button"
          onClick={() => setMode("upload")}
          className={cn(
            "flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors",
            mode === "upload"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Upload file
        </button>
        <button
          type="button"
          onClick={() => setMode("url")}
          className={cn(
            "flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors",
            mode === "url"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Image URL
        </button>
      </div>

      {mode === "upload" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
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
              {value instanceof File ? value.name : "Drop image here or click to browse"}
            </p>
            <p className="text-xs text-muted-foreground">
              PNG, JPG, GIF, WebP up to 10MB
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
            name={`${name}_file`}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            id={name}
            name={`${name}_url`}
            type="url"
            placeholder="https://example.com/image.jpg"
            value={urlInput}
            onChange={handleUrlChange}
          />
        </div>
      )}

      {/* Preview */}
      {previewUrl && (
        <div className="relative inline-block">
          <img
            src={previewUrl}
            alt="Preview"
            className="max-h-40 rounded-lg border border-border object-contain"
            onError={() => setPreviewUrl(null)}
          />
          <button
            type="button"
            onClick={handleClear}
            className="absolute -right-2 -top-2 inline-flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/80"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      )}

      {!previewUrl && !value && (
        <div className="flex size-20 items-center justify-center rounded-lg border border-dashed border-border">
          <ImageIcon className="size-6 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
