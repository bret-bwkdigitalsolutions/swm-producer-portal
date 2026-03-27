"use client";

import { useActionState } from "react";
import { updateAiSuggestion, retryPlatform } from "./actions";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowLeftIcon,
  CheckIcon,
  XIcon,
  RefreshCwIcon,
  ExternalLinkIcon,
  Loader2Icon,
  MonitorPlayIcon,
  RadioIcon,
  HeadphonesIcon,
  CastIcon,
  CrownIcon,
  GlobeIcon,
  SparklesIcon,
  FileTextIcon,
  BookOpenIcon,
  ListIcon,
} from "lucide-react";

interface Platform {
  id: string;
  platform: string;
  status: string;
  error: string | null;
  externalId: string | null;
  externalUrl: string | null;
  completedAt: string | null;
}

interface AiSuggestion {
  id: string;
  type: string;
  content: string;
  accepted: boolean;
}

interface SerializedJob {
  id: string;
  title: string;
  showName: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  platforms: Platform[];
  aiSuggestions: AiSuggestion[];
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  youtube: <MonitorPlayIcon className="size-4" />,
  spotify: <RadioIcon className="size-4" />,
  apple: <HeadphonesIcon className="size-4" />,
  transistor: <CastIcon className="size-4" />,
  patreon: <CrownIcon className="size-4" />,
  website: <GlobeIcon className="size-4" />,
};

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  spotify: "Spotify",
  apple: "Apple Podcasts",
  transistor: "Transistor",
  patreon: "Patreon",
  website: "Website",
};

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  uploading: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  processing: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  pending: "bg-muted text-muted-foreground",
  awaiting_review: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  uploading: "Uploading",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  pending: "Pending",
  awaiting_review: "Awaiting Review",
};

const SUGGESTION_ICONS: Record<string, React.ReactNode> = {
  chapters: <ListIcon className="size-4" />,
  summary: <FileTextIcon className="size-4" />,
  blog: <BookOpenIcon className="size-4" />,
};

const SUGGESTION_LABELS: Record<string, string> = {
  chapters: "Chapter Suggestions",
  summary: "Episode Summary",
  blog: "Blog Recommendations",
};

function PlatformStatusRow({ platform }: { platform: Platform }) {
  const [retryState, retryAction, isRetrying] = useActionState(retryPlatform, {});

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">
          {PLATFORM_ICONS[platform.platform]}
        </span>
        <div>
          <p className="text-sm font-medium">
            {PLATFORM_LABELS[platform.platform] ?? platform.platform}
          </p>
          {platform.error && (
            <p className="text-xs text-destructive">{platform.error}</p>
          )}
          {platform.completedAt && (
            <p className="text-xs text-muted-foreground">
              Completed{" "}
              {new Date(platform.completedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge className={STATUS_COLORS[platform.status] ?? ""}>
          {STATUS_LABELS[platform.status] ?? platform.status}
        </Badge>

        {platform.externalUrl && (
          <a
            href={platform.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLinkIcon className="size-4" />
          </a>
        )}

        {platform.status === "failed" && (
          <form action={retryAction}>
            <input type="hidden" name="platform_job_id" value={platform.id} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={isRetrying}
            >
              {isRetrying ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-3.5" />
              )}
              Retry
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function AiSuggestionCard({ suggestion }: { suggestion: AiSuggestion }) {
  const [state, formAction, isPending] = useActionState(updateAiSuggestion, {});

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            {SUGGESTION_ICONS[suggestion.type]}
          </span>
          <CardTitle className="text-base">
            {SUGGESTION_LABELS[suggestion.type] ?? suggestion.type}
          </CardTitle>
          {suggestion.accepted && (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
              Accepted
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={formAction}>
          <input type="hidden" name="suggestion_id" value={suggestion.id} />
          <Textarea
            name="edited_content"
            defaultValue={suggestion.content}
            rows={6}
            className="font-mono text-sm"
          />

          {state.message && (
            <p
              className={`mt-2 text-sm ${state.success ? "text-green-700 dark:text-green-400" : "text-destructive"}`}
            >
              {state.message}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <Button
              type="submit"
              name="action"
              value="accept"
              size="sm"
              disabled={isPending}
            >
              {isPending ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <CheckIcon className="size-3.5" />
              )}
              Accept
            </Button>
            <Button
              type="submit"
              name="action"
              value="reject"
              variant="outline"
              size="sm"
              disabled={isPending}
            >
              <XIcon className="size-3.5" />
              Reject
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function JobDetailView({ job }: { job: SerializedJob }) {
  const metadata = job.metadata;
  const description = (metadata.description as string) ?? "";
  const tags = (metadata.tags as string[]) ?? [];
  const videoFileName = (metadata.videoFileName as string) ?? "";
  const scheduleMode = (metadata.scheduleMode as string) ?? "now";
  const scheduledAt = (metadata.scheduledAt as string) ?? null;

  const createdDate = new Date(job.createdAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/dashboard/distribute"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back to distributions
          </Link>
          <h2 className="text-2xl font-bold">{job.title}</h2>
          <p className="text-sm text-muted-foreground">
            {job.showName} &middot; {createdDate}
          </p>
        </div>
        <Badge className={STATUS_COLORS[job.status] ?? ""}>
          {STATUS_LABELS[job.status] ?? job.status}
        </Badge>
      </div>

      {/* Metadata card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Episode Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {description && (
            <div>
              <p className="font-medium text-muted-foreground">Description</p>
              <p className="mt-1 whitespace-pre-wrap">{description}</p>
            </div>
          )}
          {tags.length > 0 && (
            <div>
              <p className="font-medium text-muted-foreground">Tags</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {videoFileName && (
            <div>
              <p className="font-medium text-muted-foreground">Video File</p>
              <p className="mt-1">{videoFileName}</p>
            </div>
          )}
          {scheduleMode === "schedule" && scheduledAt && (
            <div>
              <p className="font-medium text-muted-foreground">Scheduled For</p>
              <p className="mt-1">
                {new Date(scheduledAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Platform statuses */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Platform Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {job.platforms.map((platform) => (
            <PlatformStatusRow key={platform.id} platform={platform} />
          ))}
        </CardContent>
      </Card>

      {/* AI Suggestions panel — shown when job is awaiting_review or has suggestions */}
      {job.aiSuggestions.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-5 text-purple-500" />
            <h3 className="text-lg font-semibold">AI Suggestions</h3>
          </div>
          {job.status === "awaiting_review" && (
            <p className="text-sm text-muted-foreground">
              Review and accept or reject each AI-generated suggestion below.
              You can edit the content before accepting.
            </p>
          )}
          {job.aiSuggestions.map((suggestion) => (
            <AiSuggestionCard key={suggestion.id} suggestion={suggestion} />
          ))}
        </div>
      )}
    </div>
  );
}
