"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CalendarIcon,
  MonitorPlayIcon,
  RadioIcon,
  HeadphonesIcon,
  CastIcon,
  MicIcon,
  CrownIcon,
  GlobeIcon,
} from "lucide-react";

type PlatformStatus = {
  id: string;
  platform: string;
  status: string;
  error: string | null;
  externalUrl: string | null;
};

export interface DistributionJobSummary {
  id: string;
  title: string;
  showName: string;
  status: string;
  createdAt: string;
  platforms: PlatformStatus[];
}

const STATUS_STYLES: Record<string, { variant: string; label: string }> = {
  pending: { variant: "secondary", label: "Pending" },
  queued: { variant: "secondary", label: "Queued" },
  processing: { variant: "outline", label: "Processing" },
  uploading: { variant: "outline", label: "Uploading" },
  awaiting_review: { variant: "outline", label: "Awaiting Review" },
  completed: { variant: "default", label: "Completed" },
  failed: { variant: "destructive", label: "Failed" },
};

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  youtube: <MonitorPlayIcon className="size-3.5" />,
  spotify: <RadioIcon className="size-3.5" />,
  apple: <HeadphonesIcon className="size-3.5" />,
  transistor: <CastIcon className="size-3.5" />,
  podbean: <MicIcon className="size-3.5" />,
  patreon: <CrownIcon className="size-3.5" />,
  website: <GlobeIcon className="size-3.5" />,
};

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  spotify: "Spotify",
  apple: "Apple",
  transistor: "Transistor",
  podbean: "Podbean",
  patreon: "Patreon",
  website: "Website",
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? {
    variant: "secondary",
    label: status,
  };

  const colorClasses: Record<string, string> = {
    queued: "bg-muted text-muted-foreground",
    pending: "bg-muted text-muted-foreground",
    uploading: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    processing: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    awaiting_review: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  };

  return (
    <Badge className={colorClasses[status] ?? ""}>
      {style.label}
    </Badge>
  );
}

function PlatformBadge({
  platform,
  status,
}: {
  platform: string;
  status: string;
}) {
  const icon = PLATFORM_ICONS[platform];
  const label = PLATFORM_LABELS[platform] ?? platform;

  const dotColors: Record<string, string> = {
    queued: "bg-gray-400",
    uploading: "bg-blue-500",
    processing: "bg-yellow-500",
    completed: "bg-green-500",
    failed: "bg-red-500",
  };

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={`size-1.5 rounded-full ${dotColors[status] ?? "bg-gray-400"}`}
      />
      {icon}
      {label}
    </span>
  );
}

export function JobCard({ job }: { job: DistributionJobSummary }) {
  const date = new Date(job.createdAt);
  const formattedDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <Link href={`/dashboard/distribute/${job.id}`}>
      <Card className="transition-colors hover:border-primary/30 hover:bg-muted/30">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate text-base">{job.title}</CardTitle>
              <p className="text-sm text-muted-foreground">{job.showName}</p>
            </div>
            <StatusBadge status={job.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            {job.platforms.map((p) => (
              <PlatformBadge
                key={p.id}
                platform={p.platform}
                status={p.status}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarIcon className="size-3" />
            {formattedDate}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export { StatusBadge, PlatformBadge };
