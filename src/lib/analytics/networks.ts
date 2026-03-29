export interface Network {
  slug: string;
  name: string;
  wpShowIds: number[];
  credentialWpShowId: number;
}

export const NETWORKS: Network[] = [
  {
    slug: "sunset-lounge-dfw",
    name: "Sunset Lounge DFW",
    wpShowIds: [22, 23, 24, 25, 26, 27, 28],
    credentialWpShowId: 0,
  },
  {
    slug: "your-dark-companion",
    name: "Your Dark Companion",
    wpShowIds: [21],
    credentialWpShowId: 21,
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
