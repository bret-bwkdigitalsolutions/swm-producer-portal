"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Loader2Icon,
  PenLineIcon,
  ExternalLinkIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "lucide-react";
import { generateBlogPost } from "./actions";

interface GenerateBlogButtonProps {
  suggestionId: string;
  episodeTitle: string;
  generated: boolean;
  styleGuideHost?: string;
}

export function GenerateBlogButton({
  suggestionId,
  episodeTitle,
  generated,
  styleGuideHost,
}: GenerateBlogButtonProps) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    googleDocUrl?: string;
  } | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setResult(null);

    try {
      const res = await generateBlogPost(
        suggestionId,
        customInstructions.trim() || undefined
      );
      setResult({
        success: res.success,
        message: res.message,
        googleDocUrl: res.googleDocUrl,
      });
    } catch {
      setResult({ success: false, message: "Generation failed unexpectedly." });
    } finally {
      setGenerating(false);
    }
  }

  if (generated && !result) {
    return (
      <span className="text-xs text-muted-foreground">
        Blog post already generated
      </span>
    );
  }

  if (result?.success && result.googleDocUrl) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-green-700">{result.message}</p>
        <a
          href={result.googleDocUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" size="sm">
            <ExternalLinkIcon className="size-3.5" />
            Open Google Doc
          </Button>
        </a>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.refresh()}
          className="text-xs"
        >
          Show full controls
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
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

        {!generating && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPromptEditor(!showPromptEditor)}
          >
            {showPromptEditor ? (
              <ChevronUpIcon className="size-3.5" />
            ) : (
              <ChevronDownIcon className="size-3.5" />
            )}
            Customize
          </Button>
        )}
      </div>

      {styleGuideHost && !generating && (
        <span className="text-xs text-muted-foreground">
          Using {styleGuideHost}&apos;s style guide
        </span>
      )}

      {showPromptEditor && !generating && (
        <div className="space-y-1.5">
          <Label
            htmlFor={`instructions-${suggestionId}`}
            className="text-xs text-muted-foreground"
          >
            Additional instructions for the AI writer (optional)
          </Label>
          <Textarea
            id={`instructions-${suggestionId}`}
            placeholder="e.g., Focus more on the legal aspects, make the tone more casual, include statistics about..."
            rows={3}
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            className="text-sm"
          />
        </div>
      )}

      {result && !result.success && (
        <p className="text-sm text-destructive">{result.message}</p>
      )}
    </div>
  );
}
