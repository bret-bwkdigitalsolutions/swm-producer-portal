import type { SocialAccountKind, SocialPlatform } from "@/lib/social/types";

export interface SocialAccountSummary {
  id: string;
  platform: string;
  kind: string;
  wpShowId: number | null;
  hostName: string | null;
  handle: string;
  displayName: string | null;
  status: string;
  latestFollowerCount: number | null;
  latestCapturedAt: Date | null;
}

export interface GroupedAccounts {
  show: Map<number, SocialAccountSummary[]>;
  host: Map<string, SocialAccountSummary[]>;
  network: SocialAccountSummary[];
}

export function groupByKind(accounts: SocialAccountSummary[]): GroupedAccounts {
  const grouped: GroupedAccounts = {
    show: new Map(),
    host: new Map(),
    network: [],
  };

  for (const account of accounts) {
    if (account.status === "removed") continue;

    if (account.kind === "show" && account.wpShowId !== null) {
      const list = grouped.show.get(account.wpShowId) ?? [];
      list.push(account);
      grouped.show.set(account.wpShowId, list);
    } else if (account.kind === "host" && account.hostName) {
      const list = grouped.host.get(account.hostName) ?? [];
      list.push(account);
      grouped.host.set(account.hostName, list);
    } else if (account.kind === "network") {
      grouped.network.push(account);
    }
  }

  return grouped;
}

export const PLATFORM_ORDER: SocialPlatform[] = [
  "facebook_page",
  "instagram",
  "tiktok",
  "x",
];

export function sortByPlatform(
  accounts: SocialAccountSummary[]
): SocialAccountSummary[] {
  return [...accounts].sort(
    (a, b) =>
      PLATFORM_ORDER.indexOf(a.platform as SocialPlatform) -
      PLATFORM_ORDER.indexOf(b.platform as SocialPlatform)
  );
}

export function kindLabel(kind: SocialAccountKind): string {
  return { show: "Shows", host: "Hosts", network: "Network" }[kind];
}
