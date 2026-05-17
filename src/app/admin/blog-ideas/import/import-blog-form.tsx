"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { SparklesIcon } from "lucide-react";
import { importBlogFromGoogleDoc } from "./actions";
import { proposeBlogMetadata } from "./propose-actions";

interface Show {
  id: number;
  title: string;
}

interface ImportBlogFormProps {
  shows: Show[];
}

type SourceMode = "url" | "upload";

export function ImportBlogForm({ shows }: ImportBlogFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [sourceMode, setSourceMode] = useState<SourceMode>("url");
  const [wpShowId, setWpShowId] = useState<string>("");
  const [primaryLanguage, setPrimaryLanguage] = useState<string>("en");
  const [publishLive, setPublishLive] = useState(false);

  // Controlled so the Analyze button can populate them
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [seoKeyphrase, setSeoKeyphrase] = useState("");

  // Analyze flow
  const [analyzing, startAnalyze] = useTransition();
  const [analyzeMessage, setAnalyzeMessage] = useState<{
    text: string;
    success: boolean;
  } | null>(null);

  // Main submit
  const [state, action, isPending] = useActionState(
    importBlogFromGoogleDoc,
    {}
  );

  if (state?.success && state.blogPostId) {
    setTimeout(() => router.refresh(), 0);
  }

  function handleAnalyze() {
    if (!formRef.current) return;
    setAnalyzeMessage(null);
    startAnalyze(async () => {
      const formData = new FormData(formRef.current!);
      const result = await proposeBlogMetadata({}, formData);
      if (result.success && result.metadata) {
        setTitle(result.metadata.title);
        setExcerpt(result.metadata.excerpt);
        setSeoDescription(result.metadata.seoDescription);
        setSeoKeyphrase(result.metadata.seoKeyphrase);
        setAnalyzeMessage({
          text: "Metadata filled. Review and edit before submitting.",
          success: true,
        });
      } else {
        setAnalyzeMessage({
          text: result.message ?? "Analysis failed.",
          success: false,
        });
      }
    });
  }

  const busy = isPending || analyzing;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Blog</CardTitle>
        <p className="text-sm text-muted-foreground">
          Publish a host-authored post directly. Paste a Google Doc URL, or
          upload a .docx / .md / .txt file. Words are imported verbatim;
          formatting is cleaned. Translation to the other language runs
          automatically.
        </p>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          action={action}
          className="space-y-4"
          encType="multipart/form-data"
        >
          {/* Source toggle */}
          <div className="flex gap-2 rounded-md border p-1 w-fit">
            <SourceTab
              active={sourceMode === "url"}
              onClick={() => setSourceMode("url")}
            >
              Google Doc URL
            </SourceTab>
            <SourceTab
              active={sourceMode === "upload"}
              onClick={() => setSourceMode("upload")}
            >
              Upload file
            </SourceTab>
          </div>
          <input type="hidden" name="sourceMode" value={sourceMode} />

          {sourceMode === "url" ? (
            <div className="space-y-2">
              <Label htmlFor="docUrl">Google Doc URL</Label>
              <Input
                id="docUrl"
                name="docUrl"
                placeholder="https://docs.google.com/document/d/..."
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">
                The Doc must be shared with the portal&apos;s Google service
                account.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="file">File</Label>
              <Input
                id="file"
                name="file"
                type="file"
                accept=".docx,.md,.markdown,.txt"
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">
                Accepted: .docx, .md, .txt. Max 5 MB.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="wpShowId">Show</Label>
              <Select
                value={wpShowId}
                onValueChange={(v) => setWpShowId(v ?? "")}
                disabled={busy}
              >
                <SelectTrigger id="wpShowId">
                  <SelectValue placeholder="Pick a show" />
                </SelectTrigger>
                <SelectContent>
                  {shows.map((show) => (
                    <SelectItem key={show.id} value={String(show.id)}>
                      {show.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="wpShowId" value={wpShowId} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="primaryLanguage">Primary language</Label>
              <Select
                value={primaryLanguage}
                onValueChange={(v) => setPrimaryLanguage(v ?? "en")}
                disabled={busy}
              >
                <SelectTrigger id="primaryLanguage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="es">Spanish</SelectItem>
                </SelectContent>
              </Select>
              <input
                type="hidden"
                name="primaryLanguage"
                value={primaryLanguage}
              />
              <p className="text-xs text-muted-foreground">
                The language of the imported text. The other language is
                auto-translated.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="author">Author</Label>
            <Input
              id="author"
              name="author"
              placeholder="Tyler Kern"
              required
              disabled={busy}
            />
          </div>

          {/* Analyze button — proposes title/excerpt/SEO desc/keyphrase from content */}
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAnalyze}
              disabled={busy}
            >
              <SparklesIcon className="mr-2 size-3.5" />
              {analyzing ? "Analyzing…" : "Auto-fill metadata from content"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Reads the doc/file and proposes title, excerpt, SEO description,
              and keyphrase. Review and tweak before submitting.
            </p>
            {analyzeMessage && (
              <p
                className={
                  analyzeMessage.success
                    ? "text-xs text-green-600 basis-full"
                    : "text-xs text-destructive basis-full"
                }
              >
                {analyzeMessage.text}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">
              Title{" "}
              <span className="text-xs text-muted-foreground">
                (leave blank to use the doc/file title)
              </span>
            </Label>
            <Input
              id="title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="excerpt">
              Excerpt{" "}
              <span className="text-xs text-muted-foreground">
                (~30 words, shown on listing pages)
              </span>
            </Label>
            <Textarea
              id="excerpt"
              name="excerpt"
              rows={2}
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              required
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="seoDescription">
              SEO description{" "}
              <span className="text-xs text-muted-foreground">
                ({seoDescription.length}/160 characters)
              </span>
            </Label>
            <Textarea
              id="seoDescription"
              name="seoDescription"
              rows={2}
              maxLength={160}
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              required
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="seoKeyphrase">
              Focus keyphrase{" "}
              <span className="text-xs text-muted-foreground">
                (2-4 words)
              </span>
            </Label>
            <Input
              id="seoKeyphrase"
              name="seoKeyphrase"
              value={seoKeyphrase}
              onChange={(e) => setSeoKeyphrase(e.target.value)}
              required
              disabled={busy}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="publishLive"
              name="publishLive"
              checked={publishLive}
              onCheckedChange={(v) => setPublishLive(v === true)}
              disabled={busy}
            />
            <Label
              htmlFor="publishLive"
              className="text-sm font-normal cursor-pointer"
            >
              Publish live now{" "}
              <span className="text-xs text-muted-foreground">
                (leave unchecked to drop a draft into WordPress for review)
              </span>
            </Label>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              {isPending
                ? "Importing…"
                : publishLive
                  ? "Import and Publish"
                  : "Import as Draft"}
            </Button>
            {state?.message && (
              <span
                className={
                  state.success
                    ? "text-sm text-green-600"
                    : "text-sm text-destructive"
                }
              >
                {state.message}
              </span>
            )}
            {state?.success && state.wpPostUrl && (
              <a
                href={state.wpPostUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm underline"
              >
                Open in WordPress →
              </a>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SourceTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded px-3 py-1.5 text-sm font-medium transition-colors " +
        (active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}
