"use client";

import { useState } from "react";
import { FormShell } from "@/components/forms/form-shell";
import { PublishToggle, PublishState } from "@/components/forms/publish-toggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitShow } from "@/app/dashboard/show/actions";
import { ShieldCheckIcon } from "lucide-react";

interface ExistingShow {
  id: number;
  title: string;
  slug: string;
}

interface ShowFormProps {
  existingShows: ExistingShow[];
}

export function ShowForm({ existingShows }: ShowFormProps) {
  const [publishState, setPublishState] = useState<PublishState>({
    status: "publish",
  });

  return (
    <div className="space-y-6">
      {/* Admin badge */}
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
        <ShieldCheckIcon className="size-4 shrink-0" />
        Admin only -- creates a new show in WordPress
      </div>

      <FormShell title="New Show" action={submitShow} submitLabel="Create Show">
        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title">
            Show Title <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            name="title"
            placeholder="e.g. The Cold Case Files"
            required
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            placeholder="A brief description of the show..."
            rows={4}
          />
        </div>

        {/* Host Names */}
        <div className="space-y-2">
          <Label htmlFor="host_names">Host Names</Label>
          <Input
            id="host_names"
            name="host_names"
            placeholder="e.g. John Doe, Jane Smith"
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated list of host names
          </p>
        </div>

        {/* Social Links section */}
        <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
          <p className="text-sm font-medium">Social Links</p>

          <div className="space-y-2">
            <Label htmlFor="youtube_url">YouTube URL</Label>
            <Input
              id="youtube_url"
              name="youtube_url"
              type="url"
              placeholder="https://youtube.com/@channel"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="spotify_url">Spotify URL</Label>
            <Input
              id="spotify_url"
              name="spotify_url"
              type="url"
              placeholder="https://open.spotify.com/show/..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="apple_url">Apple Podcasts URL</Label>
            <Input
              id="apple_url"
              name="apple_url"
              type="url"
              placeholder="https://podcasts.apple.com/podcast/..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="website_url">Website URL</Label>
            <Input
              id="website_url"
              name="website_url"
              type="url"
              placeholder="https://show-website.com"
            />
          </div>
        </div>

        {/* Accent Color */}
        <div className="space-y-2">
          <Label htmlFor="accent_color">Accent Color</Label>
          <div className="flex items-center gap-3">
            <Input
              id="accent_color"
              name="accent_color"
              type="text"
              placeholder="#FF5500"
              pattern="^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$"
              className="max-w-[140px] font-mono"
            />
            <input
              type="color"
              aria-label="Pick accent color"
              className="size-9 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
              onChange={(e) => {
                const input = document.getElementById(
                  "accent_color"
                ) as HTMLInputElement;
                if (input) {
                  input.value = e.target.value;
                  // Trigger React's change detection
                  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    "value"
                  )?.set;
                  nativeInputValueSetter?.call(input, e.target.value);
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                }
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Hex color code used for show branding
          </p>
        </div>

        <PublishToggle value={publishState} onChange={setPublishState} />
      </FormShell>

      {/* Existing shows reference */}
      {existingShows.length > 0 && (
        <div className="mx-auto w-full max-w-2xl rounded-lg border border-border bg-muted/20 p-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Existing Shows ({existingShows.length})
          </p>
          <div className="space-y-1">
            {existingShows.map((show) => (
              <div
                key={show.id}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
              >
                <span>{show.title}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  /{show.slug}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
