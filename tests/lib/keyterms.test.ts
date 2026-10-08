import { describe, expect, it } from "vitest";
import { getShowName } from "@/lib/analytics/networks";
import {
  buildDeepgramListenQuery,
  keytermsForShow,
  keytermsFromHosts,
  MAX_KEYTERMS,
} from "@/lib/keyterms";

describe("keytermsForShow", () => {
  it("keeps show ids aligned with the WordPress show map", () => {
    expect(getShowName(21)).toBe("Your Dark Companion");
    expect(getShowName(22)).toBe("¡Al Maximo!");
    expect(getShowName(25)).toBe("Engel Angle");
    expect(getShowName(26)).toBe("Just Wondering… with Norm Hitzges");
    expect(getShowName(27)).toBe("Signal 51 Chronicles");
    expect(getShowName(28)).toBe("Sunset Soccer Club");
  });

  it("boosts soccer names on Sunset SC and not on Signal 51 or YDC", () => {
    const sunset = keytermsForShow(28);
    for (const name of [
      "Pochettino",
      "Tanner Tessmann",
      "Youri Tielemans",
      "Jozy Altidore",
      "Joe Scally",
      "Tyler Kern",
      "Aston Villa",
    ]) {
      expect(sunset).toContain(name);
    }

    for (const showId of [21, 27]) {
      const terms = keytermsForShow(showId);
      expect(terms).not.toContain("Pochettino");
      expect(terms).not.toContain("Youri Tielemans");
      expect(terms).not.toContain("Joe Scally");
    }
    expect(keytermsForShow(27)).toContain("Kennedale");
    expect(keytermsForShow(27)).toContain("Cullen Davis");
    expect(keytermsForShow(21)).toContain("Eric Nadel");
    expect(keytermsForShow(21)).toContain("Grant Halliburton");
  });

  it("includes network hosts on every show, including an unknown id", () => {
    for (const showId of [24, 25, 26, 99, undefined]) {
      const terms = keytermsForShow(showId);
      for (const name of [
        "Norm Hitzges",
        "Hitzges",
        "Rhyner",
        "Gruber",
        "Grubes",
        "Hawila",
        "Engel Angle",
        "Delkus",
        "Blaskovich",
        "Nadel",
      ]) {
        expect(terms, `show ${showId}`).toContain(name);
      }
    }
    expect(keytermsForShow(25)).toContain("Mac Engel");
    expect(keytermsForShow(26)).toContain("Tony Casillas");
    expect(keytermsForShow(22)).toContain("Pochettino");
  });

  it("merges ShowMetadata hosts and drops duplicates and weight-like tokens", () => {
    const terms = keytermsForShow(26, [
      ...keytermsFromHosts("Norm Hitzges, Jane Doe"),
      "Jane Doe",
      "Bad:weight",
    ]);
    expect(terms.filter((term) => term.toLowerCase() === "norm hitzges")).toHaveLength(1);
    expect(terms).toContain("Jane Doe");
    expect(terms).not.toContain("Bad:weight");
    expect(keytermsFromHosts("  ")).toEqual([]);
    expect(keytermsFromHosts(null)).toEqual([]);
  });

  it("stays inside the Deepgram keyterm budget", () => {
    const extras = Array.from({ length: 200 }, (_, i) => `Guest ${i}`);
    const terms = keytermsForShow(28, extras);
    expect(terms.length).toBeLessThanOrEqual(MAX_KEYTERMS);
    expect(terms).toContain("Pochettino");
  });
});

describe("buildDeepgramListenQuery", () => {
  it("repeats keyterm params and does not comma-join or attach weights", () => {
    const keyterms = keytermsForShow(28);
    const query = buildDeepgramListenQuery({ keyterms, forceLanguage: "es" });

    expect(query.get("model")).toBe("nova-3");
    expect(query.get("language")).toBe("es");
    expect(query.has("detect_language")).toBe(false);
    const sent = query.getAll("keyterm");
    expect(sent.length).toBe(keyterms.length);
    expect(sent).toContain("Youri Tielemans");
    expect(sent.some((term) => term.includes(","))).toBe(false);
    expect(sent.some((term) => term.includes(":"))).toBe(false);
  });

  it("auto-detects language when none is forced", () => {
    const query = buildDeepgramListenQuery({ keyterms: ["Hawila", "Norm Hitzges"] });
    expect(query.get("detect_language")).toBe("true");
    expect(query.has("language")).toBe(false);
    expect(query.getAll("keyterm")).toEqual(["Hawila", "Norm Hitzges"]);
    expect(query.toString()).toContain("keyterm=Hawila");
    expect(query.toString()).toContain("keyterm=Norm+Hitzges");
  });
});

describe("SWM-190 host and show names", () => {
  it("sends Rhyner and Engel keyterms on every show", () => {
    for (const showId of [21, 22, 23, 24, 25, 26, 27, 28, 4218, undefined]) {
      const terms = keytermsForShow(showId);
      expect(terms).toContain("Rhyner");
      expect(terms).toContain("Mike Rhyner");
      expect(terms).toContain("Mac Engel");
      expect(terms).toContain("Engel Angle");
      expect(terms.length).toBeLessThanOrEqual(MAX_KEYTERMS);
    }
  });
});
