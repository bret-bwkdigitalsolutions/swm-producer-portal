import { requireContentTypeAccess } from "@/lib/auth-guard";
import { getCachedShows } from "@/lib/wordpress/cache";
import { db } from "@/lib/db";
import { ContentType } from "@/lib/constants";
import { ReactionForm } from "@/components/forms/reaction-form";

export default async function ReactionPage() {
  const session = await requireContentTypeAccess(ContentType.REACTION);

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

  const defaultShow = shows.find((show) =>
    show.title.toLowerCase().includes("sunset soccer")
  );

  return (
    <div className="py-6">
      <ReactionForm shows={shows} defaultShowId={defaultShow?.id} />
    </div>
  );
}
