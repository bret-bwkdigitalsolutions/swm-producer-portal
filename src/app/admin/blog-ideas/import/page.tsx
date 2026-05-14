import { getCachedShows } from "@/lib/wordpress/cache";
import Link from "next/link";
import { ImportBlogForm } from "./import-blog-form";

export default async function ImportBlogPage() {
  const wpShows = await getCachedShows().catch(() => []);
  const shows = wpShows.map((s) => ({
    id: s.id,
    title: s.title.rendered,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Import Blog</h2>
        <Link
          href="/admin/blog-ideas"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to Blog Ideas
        </Link>
      </div>
      <ImportBlogForm shows={shows} />
    </div>
  );
}
