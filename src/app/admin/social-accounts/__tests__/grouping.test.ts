import { describe, it, expect } from "vitest";
import { groupByKind, sortByPlatform, type SocialAccountSummary } from "../grouping";

function makeAccount(
  overrides: Partial<SocialAccountSummary>
): SocialAccountSummary {
  return {
    id: "acct-1",
    platform: "x",
    kind: "show",
    wpShowId: 1,
    hostName: null,
    handle: "@example",
    displayName: null,
    status: "active",
    latestFollowerCount: null,
    latestCapturedAt: null,
    ...overrides,
  };
}

describe("groupByKind", () => {
  it("returns empty groups for empty input", () => {
    const grouped = groupByKind([]);
    expect(grouped.show.size).toBe(0);
    expect(grouped.host.size).toBe(0);
    expect(grouped.network).toEqual([]);
  });

  it("groups show accounts by wpShowId", () => {
    const accounts = [
      makeAccount({ id: "a", wpShowId: 27, platform: "x" }),
      makeAccount({ id: "b", wpShowId: 27, platform: "instagram" }),
      makeAccount({ id: "c", wpShowId: 24, platform: "tiktok" }),
    ];
    const grouped = groupByKind(accounts);
    expect(grouped.show.get(27)).toHaveLength(2);
    expect(grouped.show.get(24)).toHaveLength(1);
  });

  it("groups host accounts by hostName", () => {
    const accounts = [
      makeAccount({
        id: "a",
        kind: "host",
        wpShowId: null,
        hostName: "John Henry",
      }),
      makeAccount({
        id: "b",
        kind: "host",
        wpShowId: null,
        hostName: "John Henry",
        platform: "tiktok",
      }),
      makeAccount({
        id: "c",
        kind: "host",
        wpShowId: null,
        hostName: "Jake White",
      }),
    ];
    const grouped = groupByKind(accounts);
    expect(grouped.host.get("John Henry")).toHaveLength(2);
    expect(grouped.host.get("Jake White")).toHaveLength(1);
  });

  it("collects network accounts in a flat list", () => {
    const accounts = [
      makeAccount({
        id: "a",
        kind: "network",
        wpShowId: null,
        hostName: null,
      }),
      makeAccount({
        id: "b",
        kind: "network",
        wpShowId: null,
        hostName: null,
        platform: "instagram",
      }),
    ];
    const grouped = groupByKind(accounts);
    expect(grouped.network).toHaveLength(2);
  });

  it("excludes accounts with status='removed'", () => {
    const accounts = [
      makeAccount({ id: "a", wpShowId: 27, status: "active" }),
      makeAccount({ id: "b", wpShowId: 27, status: "removed" }),
    ];
    const grouped = groupByKind(accounts);
    expect(grouped.show.get(27)).toHaveLength(1);
    expect(grouped.show.get(27)?.[0].id).toBe("a");
  });

  it("includes accounts with status='needs_reauth' (still visible for action)", () => {
    const accounts = [
      makeAccount({ id: "a", wpShowId: 27, status: "needs_reauth" }),
    ];
    const grouped = groupByKind(accounts);
    expect(grouped.show.get(27)).toHaveLength(1);
  });
});

describe("sortByPlatform", () => {
  it("orders accounts as facebook_page, instagram, tiktok, x", () => {
    const accounts = [
      makeAccount({ id: "x", platform: "x" }),
      makeAccount({ id: "fb", platform: "facebook_page" }),
      makeAccount({ id: "tt", platform: "tiktok" }),
      makeAccount({ id: "ig", platform: "instagram" }),
    ];
    const sorted = sortByPlatform(accounts);
    expect(sorted.map((a) => a.id)).toEqual(["fb", "ig", "tt", "x"]);
  });

  it("does not mutate the input array", () => {
    const accounts = [
      makeAccount({ id: "x", platform: "x" }),
      makeAccount({ id: "fb", platform: "facebook_page" }),
    ];
    const originalOrder = accounts.map((a) => a.id);
    sortByPlatform(accounts);
    expect(accounts.map((a) => a.id)).toEqual(originalOrder);
  });
});
