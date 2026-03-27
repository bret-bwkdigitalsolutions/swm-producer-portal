import { requireAdmin } from "@/lib/auth-guard";
import { getCachedShows } from "@/lib/wordpress/cache";
import { ShowForm } from "@/components/forms/show-form";

export default async function ShowPage() {
  await requireAdmin();

  const existingShows = await getCachedShows().catch(() => []);

  const showsList = existingShows.map((s) => ({
    id: s.id,
    title: s.title.rendered,
    slug: s.slug,
  }));

  return (
    <div className="container py-8">
      <ShowForm existingShows={showsList} />
    </div>
  );
}
