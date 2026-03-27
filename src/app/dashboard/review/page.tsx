import { requireContentTypeAccess } from "@/lib/auth-guard";
import { getCachedShows } from "@/lib/wordpress/cache";
import { db } from "@/lib/db";
import { ContentType } from "@/lib/constants";
import { ReviewForm } from "@/components/forms/review-form";

export default async function ReviewPage() {
  const session = await requireContentTypeAccess(ContentType.REVIEW);

  // Fetch all shows and filter to user's allowed shows
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
    hosts: (show.acf?.hosts as string[]) ?? [],
  }));

  return (
    <div className="py-6">
      <ReviewForm shows={shows} />
    </div>
  );
}
