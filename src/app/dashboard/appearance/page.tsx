import { requireContentTypeAccess } from "@/lib/auth-guard";
import { ContentType } from "@/lib/constants";
import { getCachedShows } from "@/lib/wordpress/cache";
import { db } from "@/lib/db";
import { AppearanceForm } from "@/components/forms/appearance-form";

export default async function AppearancePage() {
  const session = await requireContentTypeAccess(ContentType.APPEARANCE);

  const allShows = await getCachedShows().catch(() => []);

  // Filter shows to only those the producer has access to (admins see all)
  let allowedShows = allShows.map((s) => ({
    id: String(s.id),
    title: s.title.rendered,
  }));

  if (session.user.role !== "admin") {
    const userShows = await db.userShowAccess.findMany({
      where: { userId: session.user.id },
      select: { wpShowId: true },
    });
    const allowedIds = new Set(userShows.map((us) => String(us.wpShowId)));
    allowedShows = allowedShows.filter((s) => allowedIds.has(s.id));
  }

  return (
    <div className="container py-8">
      <AppearanceForm allowedShows={allowedShows} />
    </div>
  );
}
