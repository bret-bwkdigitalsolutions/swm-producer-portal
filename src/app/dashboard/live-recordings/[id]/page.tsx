import { requireAuth } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LiveRecordingStateBadge } from "@/components/dashboard/live-recording-state-badge";
import { LiveRecordingAdminActions } from "./admin-actions";
import type { LiveRecordingState } from "@/lib/live-recording/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LiveRecordingDetailPage({ params }: PageProps) {
  const session = await requireAuth();
  const { id } = await params;

  const recording = await db.liveRecording.findUnique({
    where: { id },
  });
  if (!recording) notFound();

  // Producers can view recordings only for shows they have access to.
  if (session.user.role !== "admin") {
    const access = await db.userShowAccess.findUnique({
      where: {
        userId_wpShowId: {
          userId: session.user.id,
          wpShowId: recording.wpShowId,
        },
      },
    });
    if (!access) redirect("/dashboard/live-recordings");
  }

  const isAdmin = session.user.role === "admin";
  const wpAdminBase = process.env.WP_API_URL?.replace("/wp-json/wp/v2", "");
  const wpEditUrl =
    recording.wpPostId && wpAdminBase
      ? `${wpAdminBase}/wp-admin/post.php?post=${recording.wpPostId}&action=edit`
      : null;

  return (
    <div className="mx-auto max-w-4xl space-y-4 py-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{recording.title}</h2>
        <Link
          href="/dashboard/live-recordings"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to all
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            State
            <LiveRecordingStateBadge state={recording.state as LiveRecordingState} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Field label="Show (wpShowId)" value={String(recording.wpShowId)} />
          <Field
            label="Premium only"
            value={recording.isPremiumOnly ? "Yes" : "No"}
          />
          <Field
            label="Scheduled start"
            value={recording.scheduledStartAt.toLocaleString()}
          />
          {recording.actualStartedAt && (
            <Field
              label="Actually started"
              value={recording.actualStartedAt.toLocaleString()}
            />
          )}
          {recording.actualEndedAt && (
            <Field
              label="Actually ended"
              value={recording.actualEndedAt.toLocaleString()}
            />
          )}
          {recording.archivedAt && (
            <Field
              label="Archived"
              value={recording.archivedAt.toLocaleString()}
            />
          )}
          <Field
            label="YouTube"
            value={
              <a
                href={recording.youtubeLiveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {recording.youtubeLiveUrl}
              </a>
            }
          />
          {recording.transistorEpisodeId && (
            <Field
              label="Transistor episode"
              value={recording.transistorEpisodeId}
            />
          )}
          {wpEditUrl && (
            <Field
              label="WordPress post"
              value={
                <a
                  href={wpEditUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Edit in WP →
                </a>
              }
            />
          )}
          <Field
            label="Poll attempts / last polled"
            value={`${recording.pollAttempts} / ${recording.lastPolledAt?.toLocaleString() ?? "never"}`}
          />
          {recording.downloadAttempts > 0 && (
            <Field
              label="Download attempts"
              value={String(recording.downloadAttempts)}
            />
          )}
        </CardContent>
      </Card>

      {recording.errorMessage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Last error</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-xs">
              {recording.errorMessage}
            </pre>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Admin actions</CardTitle>
          </CardHeader>
          <CardContent>
            <LiveRecordingAdminActions
              liveRecordingId={recording.id}
              state={recording.state as LiveRecordingState}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <span className="w-44 shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all">{value}</span>
    </div>
  );
}
