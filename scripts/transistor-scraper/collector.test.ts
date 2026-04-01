import { describe, it, expect } from "vitest";
import { categorizeResponse } from "./collector.js";

describe("categorizeResponse", () => {
  it("identifies a downloads overview response", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/api/v1/analytics/12345",
      { data: { attributes: { downloads: [{ date: "2026-03", downloads: 100 }] } } }
    );
    expect(result).toEqual({ type: "overview", showId: "12345" });
  });

  it("identifies a countries response", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/api/v1/analytics/12345/countries",
      { data: { attributes: { countries: [] } } }
    );
    expect(result).toEqual({ type: "countries", showId: "12345" });
  });

  it("identifies an applications response", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/api/v1/analytics/12345/applications",
      { data: { attributes: { applications: [] } } }
    );
    expect(result).toEqual({ type: "applications", showId: "12345" });
  });

  it("identifies a devices response", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/api/v1/analytics/12345/devices",
      { data: { attributes: { devices: [] } } }
    );
    expect(result).toEqual({ type: "devices", showId: "12345" });
  });

  it("returns null for unrecognized URLs", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/api/v1/shows",
      { data: [] }
    );
    expect(result).toBeNull();
  });
});
