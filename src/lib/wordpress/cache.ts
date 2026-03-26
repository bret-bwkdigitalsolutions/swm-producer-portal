import "server-only";
import { unstable_cache } from "next/cache";
import { getShows, getTaxonomyTerms } from "./client";

export const getCachedShows = unstable_cache(
  () => getShows(),
  ["wp-shows"],
  { revalidate: 3600, tags: ["wp-shows"] }
);

export const getCachedTaxonomyTerms = unstable_cache(
  (taxonomy: string) => getTaxonomyTerms(taxonomy),
  ["wp-taxonomy"],
  { revalidate: 3600, tags: ["wp-taxonomies"] }
);
