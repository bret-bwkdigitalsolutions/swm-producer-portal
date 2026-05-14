"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { synthesizeStyleGuide } from "./style-guide-actions";

interface ShowStyleGuideProps {
  wpShowId: number;
  currentStyleGuide: string | null;
  styleGuideUpdatedAt: string | null; // ISO string
  editRecordCount: number;
}

export function ShowStyleGuide({
  wpShowId,
  currentStyleGuide,
  styleGuideUpdatedAt,
  editRecordCount,
}: ShowStyleGuideProps) {
  const [synthesizing, setSynthesizing] = useState(false);
  const [styleGuide, setStyleGuide] = useState(currentStyleGuide);
  const [updatedAt, setUpdatedAt] = useState(styleGuideUpdatedAt);
  const [message, setMessage] = useState<{
    text: string;
    success: boolean;
  } | null>(null);

  async function handleSynthesize() {
    setSynthesizing(true);
    setMessage(null);

    try {
      const result = await synthesizeStyleGuide(wpShowId);
      setMessage({ text: result.message, success: result.success });
      if (result.success && result.styleGuide) {
        setStyleGuide(result.styleGuide);
        setUpdatedAt(new Date().toISOString());
      }
    } catch {
      setMessage({ text: "Synthesis failed unexpectedly.", success: false });
    } finally {
      setSynthesizing(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Voice & Style</Label>

      {editRecordCount === 0 && !styleGuide ? (
        <p className="text-xs text-muted-foreground">
          No style guide yet — publish edited blog posts to start building one.
          Auto-syncs after 5 edited posts, then refreshes every 3 new edits.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {editRecordCount} edited post{editRecordCount !== 1 ? "s" : ""}{" "}
            available
            {updatedAt && (
              <>
                {" · "}
                Last updated{" "}
                {new Date(updatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </>
            )}
            {" · "}
            <span className="text-green-600">Auto-syncs on publish</span>
          </p>

          {styleGuide && (
            <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/50 p-3 text-xs leading-relaxed whitespace-pre-wrap">
              {styleGuide}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            disabled={synthesizing || editRecordCount === 0}
            onClick={handleSynthesize}
          >
            {synthesizing ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <SparklesIcon className="size-3.5" />
            )}
            {synthesizing
              ? "Synthesizing..."
              : styleGuide
                ? "Re-sync Now"
                : "Sync Now"}
          </Button>

          {message && (
            <p
              className={`text-xs ${message.success ? "text-green-600" : "text-destructive"}`}
            >
              {message.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
