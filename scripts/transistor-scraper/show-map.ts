/**
 * Maps accounts to the portal wpShowIds they contain.
 * Kept in sync with the NETWORKS config in src/lib/analytics/networks.ts.
 */

export interface AccountShowMap {
  account: string;
  wpShowIds: number[];
}

export const ACCOUNT_SHOWS: AccountShowMap[] = [
  {
    account: "sunset_lounge",
    wpShowIds: [22, 23, 24, 25, 26, 27, 28],
  },
  {
    account: "ydc",
    wpShowIds: [21],
  },
];
