export interface Network {
  slug: string;
  name: string;
  wpShowIds: number[];
  credentialWpShowId: number;
}

// NOTE: Using placeholder show IDs. Real IDs will be populated in Task 10.
export const NETWORKS: Network[] = [
  {
    slug: "sunset-lounge-dfw",
    name: "Sunset Lounge DFW",
    wpShowIds: [1, 2, 3, 4, 5, 6, 7], // placeholder IDs
    credentialWpShowId: 0,
  },
  {
    slug: "your-dark-companion",
    name: "Your Dark Companion",
    wpShowIds: [8], // placeholder ID
    credentialWpShowId: 8, // placeholder — same as the single show
  },
];

export function getNetworkBySlug(slug: string): Network | undefined {
  return NETWORKS.find((n) => n.slug === slug);
}

export function getNetworksForRole(role: string): Network[] {
  return role === "admin" ? NETWORKS : [];
}

export function getNetworkForShow(wpShowId: number): Network | undefined {
  return NETWORKS.find((n) => n.wpShowIds.includes(wpShowId));
}

export function showHasOwnYouTube(wpShowId: number): boolean {
  const network = getNetworkForShow(wpShowId);
  if (!network) return true;
  return network.wpShowIds.length === 1;
}
