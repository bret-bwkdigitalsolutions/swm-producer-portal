export interface Network {
  slug: string;
  name: string;
  wpShowIds: number[];
  credentialWpShowId: number;
  showNames: Record<number, string>;
}

export const NETWORKS: Network[] = [
  {
    slug: "sunset-lounge-dfw",
    name: "Sunset Lounge DFW",
    wpShowIds: [22, 23, 24, 25, 26, 27, 28],
    credentialWpShowId: 0,
    showNames: {
      22: "The Clubhouse Podcast",
      23: "Sunset SC",
      24: "¡Al Maximo!",
      25: "Engel Angle",
      26: "Beer 30 Sports O'clock",
      27: "Signal 51 Chronicles",
      28: "SWM Studios",
    },
  },
  {
    slug: "your-dark-companion",
    name: "Your Dark Companion",
    wpShowIds: [21],
    credentialWpShowId: 21,
    showNames: {
      21: "Your Dark Companion",
    },
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

export function getShowName(wpShowId: number): string {
  const network = getNetworkForShow(wpShowId);
  return network?.showNames[wpShowId] ?? `Show #${wpShowId}`;
}

export function showHasOwnYouTube(wpShowId: number): boolean {
  const network = getNetworkForShow(wpShowId);
  if (!network) return true;
  return network.wpShowIds.length === 1;
}
