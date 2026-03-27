import { requireContentTypeAccess } from "@/lib/auth-guard";
import { getCachedShows } from "@/lib/wordpress/cache";
import { db } from "@/lib/db";
import { ContentType } from "@/lib/constants";
import { EpisodeForm } from "@/components/forms/episode-form";

export default async function EpisodePage() {
  const session = await requireContentTypeAccess(ContentType.EPISODE);

  const allShows = await getCachedShows().catch(() => []);

  let allowedShows;
  if (session.user.role === "admin") {
    allowedShows = allShows;
  } else {
    const userShowAccess = await db.userShowAccess.findMany({
      where: { userId: session.user.id },
      select: { wpShowId: true },
    });
    const allowedIds = new Set(userShowAccess.map((a) => a.wpShowId));
    allowedShows = allShows.filter((show) => allowedIds.has(show.id));
  }

  const shows = allowedShows.map((show) => ({
    id: String(show.id),
    title: show.title.rendered,
  }));

  return (
    <div className="py-6">
      <EpisodeForm shows={shows} />
    </div>
  );
}
