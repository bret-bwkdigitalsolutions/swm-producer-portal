"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ExternalLinkIcon,
  SendIcon,
  GlobeIcon,
  Loader2Icon,
} from "lucide-react";
import {
  updateBlogPostAuthor,
  sendToHost,
  publishToWordPress,
} from "./blog-actions";

interface BlogPostControlsProps {
  blogPost: {
    id: string;
    title: string;
    googleDocUrl: string;
    author: string | null;
    hostEmail: string | null;
    status: string;
    wpPostUrl: string | null;
    editCheckPercentage: number | null;
    editCheckLabel: string | null;
  };
  defaultHostEmail?: string;
}

export function BlogPostControls({
  blogPost,
  defaultHostEmail,
}: BlogPostControlsProps) {
  const [author, setAuthor] = useState(blogPost.author ?? "");
  const [hostEmail, setHostEmail] = useState(
    blogPost.hostEmail ?? defaultHostEmail ?? ""
  );
  const [sending, setSending] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState(blogPost.status);
  const [wpPostUrl, setWpPostUrl] = useState(blogPost.wpPostUrl);

  async function handleAuthorBlur() {
    if (author !== (blogPost.author ?? "")) {
      await updateBlogPostAuthor(blogPost.id, author);
    }
  }

  async function handleSendToHost() {
    setSending(true);
    setMessage(null);
    const result = await sendToHost(blogPost.id, hostEmail);
    setMessage(result.message);
    if (result.success) {
      setStatus("reviewing");
    }
    setSending(false);
  }

  async function handlePublish() {
    setPublishing(true);
    setMessage(null);
    const result = await publishToWordPress(blogPost.id);
    setMessage(result.message);
    if (result.success && result.wpPostUrl) {
      setStatus("published");
      setWpPostUrl(result.wpPostUrl);
    }
    setPublishing(false);
  }

  return (
    <div className="space-y-3">
      {/* Google Doc link — always visible */}
      <a
        href={blogPost.googleDocUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
      >
        <ExternalLinkIcon className="size-3.5" />
        Open Google Doc
      </a>

      {/* Status badge */}
      {status === "reviewing" && (
        <div className="flex items-center gap-2">
          <Badge className="bg-amber-100 text-amber-800">With Host</Badge>
          {blogPost.editCheckLabel && (
            <EditStatusBadge
              label={blogPost.editCheckLabel}
              percentage={blogPost.editCheckPercentage}
            />
          )}
        </div>
      )}
      {status === "published" && (
        <Badge className="bg-green-100 text-green-800">Published</Badge>
      )}

      {/* Author field — editable in draft and reviewing states */}
      {status !== "published" && (
        <div className="flex items-center gap-2">
          <Input
            placeholder="Author name"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            onBlur={handleAuthorBlur}
            className="h-8 w-48 text-sm"
          />
        </div>
      )}
      {status === "published" && author && (
        <p className="text-sm text-muted-foreground">Author: {author}</p>
      )}

      {/* Draft state: send to host(s) */}
      {status === "draft" && (
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="Email(s), comma-separated"
            value={hostEmail}
            onChange={(e) => setHostEmail(e.target.value)}
            className="h-8 w-72 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={sending || !hostEmail.trim()}
            onClick={handleSendToHost}
          >
            {sending ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <SendIcon className="size-3.5" />
            )}
            Send to Host
          </Button>
        </div>
      )}

      {/* Reviewing or Draft: publish button */}
      {(status === "draft" || status === "reviewing") && (
        <Button
          variant="outline"
          size="sm"
          disabled={publishing}
          onClick={handlePublish}
        >
          {publishing ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <GlobeIcon className="size-3.5" />
          )}
          Publish to WP
        </Button>
      )}

      {/* Published: WP link */}
      {status === "published" && wpPostUrl && (
        <a
          href={wpPostUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
        >
          <GlobeIcon className="size-3.5" />
          View on WordPress
        </a>
      )}

      {/* Action feedback */}
      {message && (
        <p className="text-sm text-muted-foreground">{message}</p>
      )}
    </div>
  );
}

function EditStatusBadge({
  label,
  percentage,
}: {
  label: string;
  percentage: number | null;
}) {
  const colorClass =
    label === "No changes"
      ? "bg-gray-100 text-gray-600"
      : label === "Edited"
        ? "bg-blue-100 text-blue-800"
        : label === "Minor edits"
          ? "bg-blue-100 text-blue-800"
          : label === "Moderate edits"
            ? "bg-amber-100 text-amber-800"
            : "bg-green-100 text-green-800"; // Heavily rewritten

  const displayText =
    label === "No changes"
      ? "No changes"
      : percentage != null
        ? `${label} (~${percentage}%)`
        : label;

  return <Badge className={colorClass}>{displayText}</Badge>;
}
