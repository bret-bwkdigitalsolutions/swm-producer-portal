"use client";

import { useState } from "react";
import { FormShell } from "@/components/forms/form-shell";
import { ShowSelect } from "@/components/forms/show-select";
import { ImageInput } from "@/components/forms/image-input";
import { PublishToggle, type PublishState } from "@/components/forms/publish-toggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitReaction } from "@/app/dashboard/reaction/actions";

type ImageValue = File | string | null;

interface ReactionFormProps {
  shows: { id: string; title: string }[];
  defaultShowId?: string;
}

export function ReactionForm({ shows, defaultShowId }: ReactionFormProps) {
  const [showId, setShowId] = useState(defaultShowId ?? "");
  const [reactionType, setReactionType] = useState("reaction");
  const [thumbnail, setThumbnail] = useState<ImageValue>(null);
  const [publishState, setPublishState] = useState<PublishState>({
    status: "publish",
  });

  return (
    <FormShell
      title="Submit a Reaction"
      action={submitReaction}
      submitLabel="Publish Reaction"
    >
      {/* Content Type */}
      <div className="space-y-2">
        <Label htmlFor="reaction_type">
          Content Type<span className="text-destructive"> *</span>
        </Label>
        <Select
          value={reactionType}
          onValueChange={(val) => { if (val !== null) setReactionType(val); }}
          required
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select content type">
              {(selectedValue: string | null) => {
                if (selectedValue === "nation_preview") return "Nation Preview";
                return "Reaction";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="reaction" label="Reaction">
              Reaction
            </SelectItem>
            <SelectItem value="nation_preview" label="Nation Preview">
              Nation Preview
            </SelectItem>
          </SelectContent>
        </Select>
        {/* Hidden input for server action form submission */}
        <input type="hidden" name="reaction_type" value={reactionType} />
      </div>

      {/* Show */}
      <ShowSelect
        allowedShows={shows}
        value={showId}
        onValueChange={setShowId}
      />

      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">
          Title<span className="text-destructive"> *</span>
        </Label>
        <Input
          id="title"
          name="title"
          type="text"
          placeholder="Enter the reaction title"
          required
        />
      </div>

      {/* YouTube Video ID */}
      <div className="space-y-2">
        <Label htmlFor="youtube_video_id">
          YouTube Video ID<span className="text-destructive"> *</span>
        </Label>
        <Input
          id="youtube_video_id"
          name="youtube_video_id"
          type="text"
          placeholder="e.g., dQw4w9WgXcQ"
          required
        />
      </div>

      {/* Thumbnail */}
      <ImageInput
        name="thumbnail"
        label="Thumbnail"
        value={thumbnail}
        onChange={setThumbnail}
      />

      {/* Teams Covered */}
      <div className="space-y-2">
        <Label htmlFor="teams_covered">Teams Covered</Label>
        <Input
          id="teams_covered"
          name="teams_covered"
          type="text"
          placeholder="Optional"
        />
      </div>

      {/* Game Window */}
      <div className="space-y-2">
        <Label htmlFor="game_window">Game Window</Label>
        <Input
          id="game_window"
          name="game_window"
          type="text"
          placeholder="Optional"
        />
      </div>

      {/* Publish Toggle */}
      <PublishToggle value={publishState} onChange={setPublishState} />
    </FormShell>
  );
}
