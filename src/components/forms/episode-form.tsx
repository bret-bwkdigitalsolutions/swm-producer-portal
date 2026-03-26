"use client";

import { useState, useCallback } from "react";
import { FormShell } from "@/components/forms/form-shell";
import { ShowSelect } from "@/components/forms/show-select";
import { RichTextEditor } from "@/components/forms/rich-text-editor";
import { PublishToggle, type PublishState } from "@/components/forms/publish-toggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { submitEpisode } from "@/app/dashboard/episode/actions";
import { ShieldAlertIcon } from "lucide-react";

interface Show {
  id: string;
  title: string;
}

interface EpisodeFormProps {
  shows: Show[];
}

export function EpisodeForm({ shows }: EpisodeFormProps) {
  const [showId, setShowId] = useState("");
  const [description, setDescription] = useState("");
  const [premiumOnly, setPremiumOnly] = useState(false);
  const [publishState, setPublishState] = useState<PublishState>({
    status: "publish",
  });

  // Build the form action that includes client-managed state in FormData
  const action = useCallback(
    async (
      prevState: { success?: boolean; message?: string; errors?: Record<string, string[]> },
      formData: FormData
    ) => {
      formData.set("description", description);
      formData.set("premium_only", String(premiumOnly));
      return submitEpisode(prevState, formData);
    },
    [description, premiumOnly]
  );

  return (
    <FormShell
      title="Submit an Episode"
      action={action}
      submitLabel="Publish Episode"
    >
      {/* Show */}
      <ShowSelect
        allowedShows={shows}
        value={showId}
        onValueChange={setShowId}
      />

      {/* Episode & Season Numbers */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="episode_number">
            Episode Number<span className="text-destructive"> *</span>
          </Label>
          <Input
            id="episode_number"
            name="episode_number"
            type="number"
            min={1}
            placeholder="e.g. 42"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="season_number">Season Number</Label>
          <Input
            id="season_number"
            name="season_number"
            type="number"
            min={1}
            placeholder="Optional"
          />
        </div>
      </div>

      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">
          Title<span className="text-destructive"> *</span>
        </Label>
        <Input
          id="title"
          name="title"
          type="text"
          placeholder="Episode title"
          required
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label>Description</Label>
        <RichTextEditor
          value={description}
          onChange={setDescription}
          placeholder="Episode description..."
        />
      </div>

      {/* Duration */}
      <div className="space-y-2">
        <Label htmlFor="duration_minutes">Duration (minutes)</Label>
        <Input
          id="duration_minutes"
          name="duration_minutes"
          type="number"
          min={1}
          placeholder="Optional"
        />
      </div>

      {/* URLs */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="vimeo_url">Vimeo URL</Label>
          <Input
            id="vimeo_url"
            name="vimeo_url"
            type="url"
            placeholder="https://vimeo.com/..."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="youtube_url">YouTube URL</Label>
          <Input
            id="youtube_url"
            name="youtube_url"
            type="url"
            placeholder="https://www.youtube.com/watch?v=..."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="podbean_url">Podbean URL</Label>
          <Input
            id="podbean_url"
            name="podbean_url"
            type="url"
            placeholder="https://www.podbean.com/..."
          />
        </div>
      </div>

      {/* Premium Only Toggle */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <ShieldAlertIcon className="size-4 text-muted-foreground" />
          <Label htmlFor="premium-toggle" className="cursor-pointer">
            Premium only (Patreon exclusive)
          </Label>
        </div>
        <Switch
          id="premium-toggle"
          checked={premiumOnly}
          onCheckedChange={setPremiumOnly}
        />
      </div>

      {/* Content Warning */}
      <div className="space-y-2">
        <Label htmlFor="content_warning">Content Warning</Label>
        <Input
          id="content_warning"
          name="content_warning"
          type="text"
          placeholder="Optional content warning"
        />
      </div>

      {/* Publish Toggle */}
      <PublishToggle value={publishState} onChange={setPublishState} />
    </FormShell>
  );
}
