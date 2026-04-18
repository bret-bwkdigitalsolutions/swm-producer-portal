import "server-only";
import { unstable_cache } from "next/cache";
import { getShows, getTaxonomyTerms } from "./client";

export const getCachedShows = unstable_cache(
  async () => {
    const shows = await getShows();
    // Don't cache empty results — likely a transient WP API failure
    if (shows.length === 0) {
      throw new Error("WP API returned no shows — not caching empty result");
    }
    return shows;
  },
  ["wp-shows"],
  { revalidate: 3600, tags: ["wp-shows"] }
);

export const getCachedTaxonomyTerms = unstable_cache(
  (taxonomy: string) => getTaxonomyTerms(taxonomy),
  ["wp-taxonomy"],
  { revalidate: 3600, tags: ["wp-taxonomies"] }
);
