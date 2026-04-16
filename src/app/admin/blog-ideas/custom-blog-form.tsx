"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2Icon,
  PenLineIcon,
  PlusIcon,
  ChevronUpIcon,
} from "lucide-react";
import {
  generateCustomBlogPost,
  listEpisodeOptions,
  type EpisodeOption,
} from "./actions";

interface Show {
  id: number;
  title: string;
}

interface CustomBlogFormProps {
  shows: Show[];
  styleGuideMap: Record<string, string>; // key: String(wpShowId), value: host first name
}

export function CustomBlogForm({ shows, styleGuideMap }: CustomBlogFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [wpShowId, setWpShowId] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [episodes, setEpisodes] = useState<EpisodeOption[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedShowId = wpShowId ? parseInt(wpShowId, 10) : null;
  const styleHost = wpShowId ? styleGuideMap[wpShowId] : undefined;

  async function handleShowChange(next: string | null) {
    setWpShowId(next ?? "");
    setJobId("");
    setEpisodes([]);
    setError(null);
    if (!next) return;
    setLoadingEpisodes(true);
    try {
      const options = await listEpisodeOptions(parseInt(next!, 10));
      setEpisodes(options);
    } catch {
      // leave empty — user can still submit without an episode
    } finally {
      setLoadingEpisodes(false);
    }
  }

  function handleReset() {
    setOpen(false);
    setWpShowId("");
    setJobId("");
    setCustomPrompt("");
    setEpisodes([]);
    setError(null);
  }

  function handleSubmit() {
    setError(null);
    if (!selectedShowId) {
      setError("Please pick a show.");
      return;
    }
    if (!customPrompt.trim()) {
      setError("Please enter a blog brief.");
      return;
    }
    startTransition(async () => {
      const result = await generateCustomBlogPost({
        wpShowId: selectedShowId,
        jobId: jobId || undefined,
        customPrompt: customPrompt.trim(),
      });
      if (result.success) {
        handleReset();
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="size-3.5" />
        Create custom blog post
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Create custom blog post</CardTitle>
        <Button variant="ghost" size="sm" onClick={handleReset}>
          <ChevronUpIcon className="size-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="custom-blog-show">
            Show <span className="text-destructive">*</span>
          </Label>
          <Select value={wpShowId} onValueChange={handleShowChange}>
            <SelectTrigger id="custom-blog-show" className="w-full sm:w-80">
              <SelectValue placeholder="Select a show" />
            </SelectTrigger>
            <SelectContent>
              {shows.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="custom-blog-episode">
            Episode <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Select
            value={jobId}
            onValueChange={(v) => setJobId(v ?? "")}
            disabled={!wpShowId || loadingEpisodes}
          >
            <SelectTrigger id="custom-blog-episode" className="w-full sm:w-80">
              <SelectValue
                placeholder={
                  loadingEpisodes
                    ? "Loading…"
                    : episodes.length === 0 && wpShowId
                      ? "No processed episodes with transcripts"
                      : "— No episode —"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {episodes.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.title} — {new Date(e.createdAt).toLocaleDateString()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {jobId && (
            <p className="text-xs text-muted-foreground">
              Transcript will be included in the prompt for grounding.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="custom-blog-brief">
            Blog brief <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="custom-blog-brief"
            rows={6}
            placeholder='e.g., "Write a piece on the history of the Dallas music scene for SXSW readers, ~800 words, tying back to our recent interview…"'
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            className="text-sm"
          />
        </div>

        {styleHost && (
          <p className="text-xs text-muted-foreground">
            Using {styleHost}&apos;s style guide
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isPending || !wpShowId || !customPrompt.trim()}
            onClick={handleSubmit}
          >
            {isPending ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <PenLineIcon className="size-3.5" />
            )}
            {isPending ? "Generating…" : "Generate Post"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={handleReset}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
