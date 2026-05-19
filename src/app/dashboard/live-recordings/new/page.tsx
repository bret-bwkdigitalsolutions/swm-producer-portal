import { requireAdmin } from "@/lib/auth-guard";
import { getCachedShows } from "@/lib/wordpress/cache";
import Link from "next/link";
import { LiveRecordingForm } from "@/components/forms/live-recording-form";

export default async function NewLiveRecordingPage() {
  // Admin-only in v1 per KTD-6 in the plan. Producer self-serve is a
  // documented follow-up.
  await requireAdmin();

  const allShows = await getCachedShows().catch(() => []);
  const allowedShows = allShows.map((s) => ({
    id: String(s.id),
    title: s.title.rendered,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-4 py-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">New Live Recording</h2>
        <Link
          href="/dashboard/live-recordings"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to Live Recordings
        </Link>
      </div>
      <LiveRecordingForm allowedShows={allowedShows} />
    </div>
  );
}
