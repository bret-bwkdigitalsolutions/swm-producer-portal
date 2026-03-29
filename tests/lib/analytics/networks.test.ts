import { describe, it, expect } from "vitest";
import {
  NETWORKS,
  getNetworkBySlug,
  getNetworksForRole,
  getNetworkForShow,
  showHasOwnYouTube,
} from "@/lib/analytics/networks";

describe("NETWORKS config", () => {
  it("has two networks defined", () => {
    expect(NETWORKS).toHaveLength(2);
  });

  it("each network has required fields", () => {
    for (const network of NETWORKS) {
      expect(network.slug).toBeTruthy();
      expect(network.name).toBeTruthy();
      expect(network.wpShowIds.length).toBeGreaterThan(0);
      expect(typeof network.credentialWpShowId).toBe("number");
    }
  });
});

describe("getNetworkBySlug", () => {
  it("returns the network for a valid slug", () => {
    const network = getNetworkBySlug("sunset-lounge-dfw");
    expect(network).toBeDefined();
    expect(network!.name).toBe("Sunset Lounge DFW");
  });

  it("returns undefined for an invalid slug", () => {
    expect(getNetworkBySlug("nonexistent")).toBeUndefined();
  });
});

describe("getNetworksForRole", () => {
  it("returns all networks for admin role", () => {
    expect(getNetworksForRole("admin")).toEqual(NETWORKS);
  });

  it("returns empty array for producer role", () => {
    expect(getNetworksForRole("producer")).toEqual([]);
  });
});

describe("getNetworkForShow", () => {
  it("returns the network containing the given wpShowId", () => {
    const sunsetShowId = NETWORKS[0].wpShowIds[0];
    const network = getNetworkForShow(sunsetShowId);
    expect(network).toBeDefined();
    expect(network!.slug).toBe("sunset-lounge-dfw");
  });

  it("returns undefined for a wpShowId not in any network", () => {
    expect(getNetworkForShow(99999)).toBeUndefined();
  });
});

describe("showHasOwnYouTube", () => {
  it("returns false for a show in a multi-show network", () => {
    const sunsetShowId = NETWORKS[0].wpShowIds[0];
    expect(showHasOwnYouTube(sunsetShowId)).toBe(false);
  });

  it("returns true for a show in a single-show network", () => {
    const ydcShowId = NETWORKS[1].wpShowIds[0];
    expect(showHasOwnYouTube(ydcShowId)).toBe(true);
  });

  it("returns true for a wpShowId not in any network", () => {
    expect(showHasOwnYouTube(99999)).toBe(true);
  });
});
