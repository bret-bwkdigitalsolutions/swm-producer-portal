"use client";

import { useState, useRef, useCallback } from "react";
import { FormShell } from "@/components/forms/form-shell";
import { ShowSelect } from "@/components/forms/show-select";
import { PublishToggle, PublishState } from "@/components/forms/publish-toggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitAppearance } from "@/app/dashboard/appearance/actions";
import { cn } from "@/lib/utils";
import { UploadCloudIcon, XIcon, ImageIcon } from "lucide-react";

interface Show {
  id: string;
  title: string;
}

interface AppearanceFormProps {
  allowedShows: Show[];
}

const NETWORK_EVENT_OPTION: Show = { id: "network_event", title: "Network Event" };

const STATUS_OPTIONS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "cancelled", label: "Cancelled" },
];

export function AppearanceForm({ allowedShows }: AppearanceFormProps) {
  const [showId, setShowId] = useState("");
  const [appearanceStatus, setAppearanceStatus] = useState("");
  const [publishState, setPublishState] = useState<PublishState>({
    status: "publish",
  });
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [galleryPreviews, setGalleryPreviews] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const showsWithNetwork = [...allowedShows, NETWORK_EVENT_OPTION];

  const addFiles = useCallback((files: FileList | File[]) => {
    const newFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (newFiles.length === 0) return;

    setGalleryFiles((prev) => [...prev, ...newFiles]);
    const newPreviews = newFiles.map((f) => URL.createObjectURL(f));
    setGalleryPreviews((prev) => [...prev, ...newPreviews]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setGalleryFiles((prev) => prev.filter((_, i) => i !== index));
    setGalleryPreviews((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleGalleryDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleGallerySelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        addFiles(e.target.files);
      }
      // Reset input so the same files can be selected again
      e.target.value = "";
    },
    [addFiles]
  );

  // Wrap the server action to inject gallery files into FormData
  const actionWithGallery = async (
    prevState: { success?: boolean; message?: string; errors?: Record<string, string[]> },
    formData: FormData
  ) => {
    // Append gallery files to FormData
    for (const file of galleryFiles) {
      formData.append("gallery", file);
    }
    const result = await submitAppearance(prevState, formData);
    if (result.success) {
      // Clear gallery on success
      galleryPreviews.forEach((url) => URL.revokeObjectURL(url));
      setGalleryFiles([]);
      setGalleryPreviews([]);
      setShowId("");
      setAppearanceStatus("");
      setPublishState({ status: "publish" });
    }
    return result;
  };

  return (
    <FormShell title="New Appearance" action={actionWithGallery} submitLabel="Submit Appearance">
      <ShowSelect
        allowedShows={showsWithNetwork}
        value={showId}
        onValueChange={setShowId}
      />

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          placeholder="Describe the appearance or event..."
          rows={4}
        />
      </div>

      {/* Date/time start */}
      <div className="space-y-2">
        <Label htmlFor="datetime_start">
          Start date/time <span className="text-destructive">*</span>
        </Label>
        <Input
          id="datetime_start"
          name="datetime_start"
          type="datetime-local"
          required
        />
      </div>

      {/* Date/time end */}
      <div className="space-y-2">
        <Label htmlFor="datetime_end">
          End date/time <span className="text-destructive">*</span>
        </Label>
        <Input
          id="datetime_end"
          name="datetime_end"
          type="datetime-local"
          required
        />
      </div>

      {/* Venue */}
      <div className="space-y-2">
        <Label htmlFor="venue">
          Venue <span className="text-destructive">*</span>
        </Label>
        <Input
          id="venue"
          name="venue"
          placeholder="e.g. The Orpheum Theatre"
          required
        />
      </div>

      {/* Location */}
      <div className="space-y-2">
        <Label htmlFor="location">
          Location <span className="text-destructive">*</span>
        </Label>
        <Input
          id="location"
          name="location"
          placeholder="City, ST"
          required
        />
      </div>

      {/* Address */}
      <div className="space-y-2">
        <Label htmlFor="address">
          Address <span className="text-destructive">*</span>
        </Label>
        <Input
          id="address"
          name="address"
          placeholder="Full street address"
          required
        />
      </div>

      {/* Ticket URL */}
      <div className="space-y-2">
        <Label htmlFor="ticket_url">Ticket URL</Label>
        <Input
          id="ticket_url"
          name="ticket_url"
          type="url"
          placeholder="https://tickets.example.com"
        />
      </div>

      {/* Event URL */}
      <div className="space-y-2">
        <Label htmlFor="event_url">Event URL</Label>
        <Input
          id="event_url"
          name="event_url"
          type="url"
          placeholder="https://event.example.com"
        />
      </div>

      {/* Status */}
      <div className="space-y-2">
        <Label htmlFor="appearance_status">
          Status <span className="text-destructive">*</span>
        </Label>
        <Select
          value={appearanceStatus}
          onValueChange={(val: string | null) => {
            if (val !== null) setAppearanceStatus(val);
          }}
          required
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="appearance_status" value={appearanceStatus} />
      </div>

      {/* Gallery multi-image upload */}
      <div className="space-y-2">
        <Label>Gallery</Label>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleGalleryDrop}
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
              PNG, JPG, GIF, WebP -- select multiple
            </p>
          </div>
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleGallerySelect}
            className="hidden"
          />
        </div>

        {/* Gallery previews */}
        {galleryPreviews.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {galleryPreviews.map((url, index) => (
              <div key={index} className="relative inline-block">
                <img
                  src={url}
                  alt={`Gallery ${index + 1}`}
                  className="size-20 rounded-lg border border-border object-cover"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(index);
                  }}
                  className="absolute -right-1.5 -top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/80"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {galleryPreviews.length === 0 && (
          <div className="flex size-20 items-center justify-center rounded-lg border border-dashed border-border">
            <ImageIcon className="size-6 text-muted-foreground" />
          </div>
        )}
      </div>

      <PublishToggle value={publishState} onChange={setPublishState} />
    </FormShell>
  );
}
