"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2Icon, PenLineIcon, ExternalLinkIcon } from "lucide-react";
import { generateBlogPost } from "./actions";

interface GenerateBlogButtonProps {
  suggestionId: string;
  episodeTitle: string;
  generated: boolean;
}

export function GenerateBlogButton({
  suggestionId,
  episodeTitle,
  generated,
}: GenerateBlogButtonProps) {
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    postUrl?: string;
  } | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setResult(null);

    try {
      const res = await generateBlogPost(suggestionId);
      setResult(res);
    } catch {
      setResult({ success: false, message: "Generation failed unexpectedly." });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {!generated && !result?.success && (
        <Button
          variant="outline"
          size="sm"
          disabled={generating}
          onClick={handleGenerate}
        >
          {generating ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <PenLineIcon className="size-3.5" />
          )}
          {generating ? "Generating..." : "Generate Post"}
        </Button>
      )}

      {result?.success && result.postUrl && (
        <a href={result.postUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm">
            <ExternalLinkIcon className="size-3.5" />
            View Draft in WordPress
          </Button>
        </a>
      )}

      {result && !result.success && (
        <p className="text-sm text-destructive">{result.message}</p>
      )}

      {generated && !result && (
        <span className="text-xs text-muted-foreground">
          Blog post already generated
        </span>
      )}
    </div>
  );
}
