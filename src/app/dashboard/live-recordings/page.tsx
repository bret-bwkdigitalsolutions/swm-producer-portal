import Link from "next/link";
import { requireAuth } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { getCachedShows } from "@/lib/wordpress/cache";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LiveRecordingStateBadge } from "@/components/dashboard/live-recording-state-badge";
import {
  ACTIVE_LIVE_RECORDING_STATES,
  type LiveRecordingState,
} from "@/lib/live-recording/types";

const PAST_WINDOW_DAYS = 14;
const UPCOMING_WINDOW_DAYS = 7;

export default async function LiveRecordingsListPage() {
  const session = await requireAuth();
  const isAdmin = session.user.role === "admin";

  // Producers see only their show's recordings; admins see everything.
  let wpShowIdFilter: number[] | null = null;
  if (!isAdmin) {
    const allowed = await db.userShowAccess.findMany({
      where: { userId: session.user.id },
      select: { wpShowId: true },
    });
    wpShowIdFilter = allowed.map((a) => a.wpShowId);
    if (wpShowIdFilter.length === 0) {
      return (
        <div className="mx-auto max-w-4xl py-8">
          <h2 className="text-2xl font-bold">Live Recordings</h2>
          <p className="mt-4 text-muted-foreground">
            You don&apos;t have access to any shows with live recordings.
          </p>
        </div>
      );
    }
  }

  const now = new Date();
  const upcomingHorizon = new Date(
    now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
  const pastFloor = new Date(
    now.getTime() - PAST_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  const recordings = await db.liveRecording.findMany({
    where: {
      ...(wpShowIdFilter ? { wpShowId: { in: wpShowIdFilter } } : {}),
      OR: [
        { scheduledStartAt: { gte: pastFloor, lte: upcomingHorizon } },
        { state: { in: ["live", "ended_pending", "stuck"] } },
      ],
    },
    orderBy: { scheduledStartAt: "desc" },
  });

  const shows = await getCachedShows().catch(() => []);
  const showTitleById = new Map<number, string>(
    shows.map((s) => [s.id, s.title.rendered])
  );

  // Bucket into Active (state in active set or stuck), Upcoming (future
  // scheduled), Recent (past + terminal)
  const active = recordings.filter(
    (r) =>
      ACTIVE_LIVE_RECORDING_STATES.has(r.state as LiveRecordingState) ||
      r.state === "stuck"
  );
  const upcoming = recordings.filter(
    (r) => r.state === "scheduled" && r.scheduledStartAt > now
  );
  const recent = recordings.filter(
    (r) =>
      (r.state === "archived" || r.state === "cancelled") &&
      r.scheduledStartAt <= now
  );

  // De-dupe — active "scheduled" rows live in both Active and Upcoming;
  // keep them in Active only.
  const activeIds = new Set(active.map((r) => r.id));
  const upcomingFiltered = upcoming.filter((r) => !activeIds.has(r.id));

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Live Recordings</h2>
          <p className="text-sm text-muted-foreground">
            Manage live broadcasts that simulcast from Vimeo Live to YouTube.
          </p>
        </div>
        {isAdmin && (
          <Link href="/dashboard/live-recordings/new">
            <Button>+ New Live Recording</Button>
          </Link>
        )}
      </div>

      {recordings.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No live recordings yet.{" "}
            {isAdmin
              ? "Click + New Live Recording to schedule one."
              : "Your admin can schedule one."}
          </CardContent>
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <RecordingsSection
              title="Active"
              recordings={active}
              showTitleById={showTitleById}
            />
          )}
          {upcomingFiltered.length > 0 && (
            <RecordingsSection
              title="Upcoming"
              recordings={upcomingFiltered}
              showTitleById={showTitleById}
            />
          )}
          {recent.length > 0 && (
            <RecordingsSection
              title="Recent"
              recordings={recent}
              showTitleById={showTitleById}
            />
          )}
        </>
      )}
    </div>
  );
}

interface RecordingsSectionProps {
  title: string;
  recordings: Array<{
    id: string;
    title: string;
    wpShowId: number;
    state: string;
    scheduledStartAt: Date;
  }>;
  showTitleById: Map<number, string>;
}

function RecordingsSection({
  title,
  recordings,
  showTitleById,
}: RecordingsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {recordings.map((r) => (
          <Link
            key={r.id}
            href={`/dashboard/live-recordings/${r.id}`}
            className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50 transition-colors"
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <LiveRecordingStateBadge
                  state={r.state as LiveRecordingState}
                />
                <span className="font-medium">{r.title}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {showTitleById.get(r.wpShowId) ?? `Show #${r.wpShowId}`}
                {" · "}
                {r.scheduledStartAt.toLocaleString()}
              </div>
            </div>
            <span className="text-xs text-muted-foreground">View →</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
