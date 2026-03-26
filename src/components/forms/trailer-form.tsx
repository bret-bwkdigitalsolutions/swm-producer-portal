"use client";

import { useState, useMemo } from "react";
import { FormShell } from "@/components/forms/form-shell";
import { ShowSelect } from "@/components/forms/show-select";
import { PublishToggle, type PublishState } from "@/components/forms/publish-toggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitTrailer } from "@/app/dashboard/trailer/actions";

interface Show {
  id: string;
  title: string;
}

interface TrailerFormProps {
  shows: Show[];
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function TrailerForm({ shows }: TrailerFormProps) {
  const [showId, setShowId] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [publishState, setPublishState] = useState<PublishState>({
    status: "publish",
  });

  const youtubeEmbedId = useMemo(
    () => (youtubeUrl ? extractYouTubeId(youtubeUrl) : null),
    [youtubeUrl]
  );

  return (
    <FormShell
      title="Submit a Trailer"
      action={submitTrailer}
      submitLabel="Publish Trailer"
    >
      {/* Show */}
      <ShowSelect
        allowedShows={shows}
        value={showId}
        onValueChange={setShowId}
      />

      {/* Movie Title */}
      <div className="space-y-2">
        <Label htmlFor="movie_title">
          Movie Title<span className="text-destructive"> *</span>
        </Label>
        <Input
          id="movie_title"
          name="movie_title"
          type="text"
          placeholder="Enter the movie title"
          required
        />
      </div>

      {/* YouTube URL */}
      <div className="space-y-2">
        <Label htmlFor="youtube_url">
          YouTube URL<span className="text-destructive"> *</span>
        </Label>
        <Input
          id="youtube_url"
          name="youtube_url"
          type="url"
          placeholder="https://www.youtube.com/watch?v=..."
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          required
        />

        {/* Embed Preview */}
        {youtubeEmbedId && (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="relative aspect-video w-full">
              <iframe
                src={`https://www.youtube.com/embed/${youtubeEmbedId}`}
                title="YouTube video preview"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            </div>
          </div>
        )}
      </div>

      {/* Release Date */}
      <div className="space-y-2">
        <Label htmlFor="release_date">Release Date</Label>
        <Input
          id="release_date"
          name="release_date"
          type="date"
          placeholder="Optional"
        />
      </div>

      {/* Publish Toggle */}
      <PublishToggle value={publishState} onChange={setPublishState} />
    </FormShell>
  );
}
