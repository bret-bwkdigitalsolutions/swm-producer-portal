"use client";

import { useActionState, useState, useEffect, useCallback } from "react";
import { updateAiSuggestion, retryPlatform, deleteJob } from "./actions";
import {
  ALL_TIERS,
  TIER_INFO,
  computeVerdict,
  describeIssue,
  issueSeverity,
  type DistributionIssue,
  type PlatformTierResult,
  type TierNumber,
  type TierResult,
  type VerificationVerdict,
} from "@/lib/jobs/verification-types";
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
  GlobeIcon,
  SparklesIcon,
  FileTextIcon,
  BookOpenIcon,
  ListIcon,
  Trash2Icon,
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
  isPremium: boolean;
  errorMessage: string | null;
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
  website: <GlobeIcon className="size-4" />,
};

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  spotify: "Spotify",
  apple: "Apple Podcasts",
  transistor: "Transistor",
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
  summary: "Description",
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

const TERMINAL_STATUSES = ["completed", "failed"];
const POLL_INTERVAL_MS = 5_000;
const VERIFICATION_POLL_INTERVAL_MS = 30_000;

export function JobDetailView({ job }: { job: SerializedJob }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [liveStatus, setLiveStatus] = useState(job.status);
  const [livePlatforms, setLivePlatforms] = useState(job.platforms);
  const [liveVerifications, setLiveVerifications] = useState<TierResult[] | null>(
    (job.metadata.verifications as TierResult[] | undefined) ?? null
  );
  const [liveIssues, setLiveIssues] = useState<DistributionIssue[]>(
    (job.metadata.distributionIssues as DistributionIssue[] | undefined) ?? []
  );
  const initialSchedule = job.metadata.verificationSchedule as
    | { version?: number; pendingTransientRecheck?: boolean }
    | undefined;
  const [scheduleVersion, setScheduleVersion] = useState<number | null>(
    initialSchedule?.version ?? null
  );
  const [awaitingRecheck, setAwaitingRecheck] = useState(
    initialSchedule?.pendingTransientRecheck === true
  );
  const [backfill, setBackfill] = useState<{ status: string } | null>(
    (job.metadata.thumbnailBackfill as { status: string } | undefined) ?? null
  );

  const isTerminal = TERMINAL_STATUSES.includes(liveStatus);
  const verdict = computeVerdict(liveVerifications, liveIssues, scheduleVersion ?? undefined, {
    awaitingTransientRecheck: awaitingRecheck,
  });
  // Verification runs up to ~60 min after distribution completes. Once the
  // job itself is terminal, poll slowly until the final verdict is in.
  const verificationsComplete = verdict.status !== "pending";

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/distribute/${job.id}/status`);
      if (!res.ok) return;
      const data = await res.json();
      setLiveStatus(data.status);
      setLivePlatforms(data.platforms);
      if (data.verifications !== undefined) setLiveVerifications(data.verifications);
      if (Array.isArray(data.distributionIssues)) setLiveIssues(data.distributionIssues);
      if (data.verificationScheduleVersion !== undefined) setScheduleVersion(data.verificationScheduleVersion);
      if (typeof data.verificationPendingTransientRecheck === "boolean") {
        setAwaitingRecheck(data.verificationPendingTransientRecheck);
      }
      if (data.thumbnailBackfill !== undefined) setBackfill(data.thumbnailBackfill);
    } catch {
      // Silently ignore — next poll will retry
    }
  }, [job.id]);

  useEffect(() => {
    if (isTerminal && verificationsComplete) return;
    const interval = setInterval(
      pollStatus,
      isTerminal ? VERIFICATION_POLL_INTERVAL_MS : POLL_INTERVAL_MS
    );
    return () => clearInterval(interval);
  }, [isTerminal, verificationsComplete, pollStatus]);

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

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    await deleteJob(job.id);
  }

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
        <div className="flex items-center gap-2">
          <Badge className={STATUS_COLORS[liveStatus] ?? ""}>
            {STATUS_LABELS[liveStatus] ?? liveStatus}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            disabled={deleting}
            onClick={handleDelete}
            className={confirmDelete ? "border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground" : ""}
          >
            {deleting ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <Trash2Icon className="size-3.5" />
            )}
            {confirmDelete ? "Confirm delete" : "Delete"}
          </Button>
        </div>
      </div>

      {/* Failure detail — surfaces the persisted analyze/processor error so
          post-mortems don't depend on Railway log retention. */}
      {liveStatus === "failed" && job.errorMessage && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-destructive">
              Failure detail
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-words text-xs text-destructive/90">
              {job.errorMessage}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Premium YouTube Studio reminder */}
      {job.isPremium && livePlatforms.some(p => p.platform === "youtube" && p.status === "completed") && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          <strong>Premium content:</strong> This video was uploaded as unlisted.
          To restrict to channel members, set it to &quot;Members only&quot; in YouTube Studio.
        </div>
      )}

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
          {livePlatforms.map((platform) => (
            <PlatformStatusRow key={platform.id} platform={platform} />
          ))}
        </CardContent>
      </Card>

      {/* Post-distribution verification — checks at 30s/2m/10m/30m + final re-check at 60m */}
      <VerificationPanel
        verifications={liveVerifications}
        platforms={livePlatforms}
        verdict={verdict}
        scheduleVersion={scheduleVersion}
        backfillStatus={backfill?.status ?? null}
        awaitingRecheck={awaitingRecheck}
      />

      {/* AI suggestions (description, chapters, blog) are reviewed during
          distribution and managed in Admin > Blog Ideas — no need to show
          them again on this status page. */}
    </div>
  );
}

function cellFor(platRes: PlatformTierResult | undefined, ran: boolean): React.ReactNode {
  if (!ran || !platRes) return <span className="text-muted-foreground">—</span>;
  const details = platRes.issues
    .map((i) => `${issueSeverity(i) === "critical" ? "✗" : "⚠"} ${describeIssue(i)}`)
    .join("\n");
  const hasCritical = platRes.issues.some((i) => issueSeverity(i) === "critical");
  if (hasCritical) {
    return <span className="text-red-600" title={details}>✗</span>;
  }
  if (platRes.issues.length > 0) {
    return <span className="text-amber-600" title={details}>⚠</span>;
  }
  return <span className="text-green-600">✓</span>;
}

const VERDICT_STYLES: Record<VerificationVerdict["status"], { className: string; text: string }> = {
  pending: {
    className: "border-muted bg-muted/40 text-muted-foreground",
    text: "Verification in progress — final check runs about 60 minutes after publishing.",
  },
  passed: {
    className: "border-green-200 bg-green-50 text-green-800",
    text: "✓ Verified — everything landed correctly.",
  },
  warnings: {
    className: "border-amber-200 bg-amber-50 text-amber-800",
    text: "⚠ Published, with minor issues (no action required).",
  },
  failed: {
    className: "border-red-200 bg-red-50 text-red-800",
    text: "❌ Verification failed — something needs attention.",
  },
};

function VerificationPanel({
  verifications,
  platforms,
  verdict,
  scheduleVersion,
  backfillStatus,
  awaitingRecheck,
}: {
  verifications: TierResult[] | null;
  platforms: Array<{ platform: string; status: string }>;
  verdict: VerificationVerdict;
  scheduleVersion: number | null;
  backfillStatus: string | null;
  awaitingRecheck: boolean;
}) {
  const tierResults = verifications ?? [];
  const completedPlatforms = platforms.filter((p) => p.status === "completed");

  if (completedPlatforms.length === 0) return null;

  // Legacy jobs (before the final re-check existed) only ran tiers 1–4.
  const tiers: TierNumber[] =
    (scheduleVersion ?? 1) >= 2 || tierResults.some((v) => v.tier === 5) ? ALL_TIERS : [1, 2, 3, 4];

  // Rows: each completed platform, plus the network Transistor cross-post if checked.
  const rowPlatforms = completedPlatforms.map((p) => p.platform);
  if (tierResults.some((v) => v.platforms.some((pl) => pl.platform === "transistor_network"))) {
    rowPlatforms.push("transistor_network");
  }

  const style = VERDICT_STYLES[verdict.status];
  const showIssues = verdict.critical.length > 0 || verdict.warnings.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Verification</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={`rounded-md border px-3 py-2 text-sm ${style.className}`}>
          {style.text}
          {backfillStatus === "pending" || backfillStatus === "running" ? (
            <div className="mt-1 text-xs opacity-80">
              Fetching the YouTube thumbnail for the website and podcast artwork…
            </div>
          ) : null}
          {awaitingRecheck ? (
            <div className="mt-1 text-xs opacity-80">
              The final check hit a temporary error and will run once more before any alert is sent.
            </div>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pb-2 text-left font-medium">Platform</th>
                {tiers.map((t) => (
                  <th key={t} className="pb-2 text-center font-medium">
                    {TIER_INFO[t].label}
                    <div className="text-[10px] font-normal opacity-70">
                      ({TIER_INFO[t].whenLabel})
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowPlatforms.map((platform) => (
                <tr key={platform} className="border-t">
                  <td className="py-2 font-medium capitalize">{PLATFORM_ROW_LABELS[platform] ?? platform}</td>
                  {tiers.map((tier) => {
                    const tierEntry = tierResults.find((v) => v.tier === tier);
                    const platRes = tierEntry?.platforms.find((pl) => pl.platform === platform);
                    return (
                      <td key={tier} className="py-2 text-center">
                        {cellFor(platRes, !!tierEntry)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showIssues && (
          <div className="space-y-2 text-xs">
            {verdict.critical.length > 0 && (
              <div>
                <div className="font-medium text-red-700">Needs attention</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-red-700">
                  {verdict.critical.map((i, idx) => (
                    <li key={`c-${idx}`}>
                      <span className="font-medium">{PLATFORM_ROW_LABELS[i.platform] ?? i.platform}:</span>{" "}
                      {describeIssue(i)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {verdict.warnings.length > 0 && (
              <div>
                <div className="font-medium text-amber-700">Warnings</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-700">
                  {verdict.warnings.map((i, idx) => (
                    <li key={`w-${idx}`}>
                      <span className="font-medium">{PLATFORM_ROW_LABELS[i.platform] ?? i.platform}:</span>{" "}
                      {describeIssue(i)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          ✓ passed · ⚠ warning (cosmetic) · ✗ failed (hover for details) · — not yet run.
          {verdict.status === "pending" ? " Earlier checks are informational; only the final check can send an alert." : ""}
        </p>
      </CardContent>
    </Card>
  );
}

const PLATFORM_ROW_LABELS: Record<string, string> = {
  youtube: "YouTube",
  transistor: "Transistor",
  transistor_network: "Transistor (network)",
  website: "Website",
};
