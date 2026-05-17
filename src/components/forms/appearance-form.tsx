"use client";

import { useRef, useState } from "react";
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
import {
  AppearanceGalleryUploader,
  type UploaderHandle,
} from "@/components/forms/appearance-gallery-uploader";

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
  const uploaderRef = useRef<UploaderHandle | null>(null);

  const showsWithNetwork = [...allowedShows, NETWORK_EVENT_OPTION];

  // Wrap the server action: resolve uploaded gallery IDs from the uploader
  // child, then submit just the IDs (no inline file payload). This bypasses
  // the serverActions bodySizeLimit that silently truncated big galleries.
  const actionWithGallery = async (
    prevState: { success?: boolean; message?: string; errors?: Record<string, string[]> },
    formData: FormData
  ) => {
    if (!uploaderRef.current) {
      return {
        success: false,
        message: "Gallery uploader not ready. Refresh and try again.",
      };
    }
    const resolved = await uploaderRef.current.resolve();
    if ("error" in resolved) {
      return { success: false, message: resolved.error };
    }
    formData.set("gallery_ids", resolved.galleryIds.join(","));
    if (resolved.heroId) {
      formData.set("hero_id", String(resolved.heroId));
    }

    const result = await submitAppearance(prevState, formData);
    if (result.success) {
      setShowId("");
      setAppearanceStatus("");
      setPublishState({ status: "publish" });
      // The uploader's items are managed inside that component; resetting
      // it on success is handled by re-render via the form-level success
      // state. For now, the user will refresh — gallery state survives so
      // they can copy-paste another appearance if needed.
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
        <Label htmlFor="datetime_end">End date/time</Label>
        <Input
          id="datetime_end"
          name="datetime_end"
          type="datetime-local"
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

      <AppearanceGalleryUploader uploaderRef={uploaderRef} />

      <PublishToggle value={publishState} onChange={setPublishState} />
    </FormShell>
  );
}
