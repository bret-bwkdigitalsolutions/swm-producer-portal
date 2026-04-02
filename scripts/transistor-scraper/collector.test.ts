import { describe, it, expect } from "vitest";
import { categorizeResponse } from "./collector.js";

describe("categorizeResponse", () => {
  it("identifies a daily_average response", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/shows/al-maximo/analytics/daily_average"
    );
    expect(result).toEqual({ type: "dailyAverage" });
  });

  it("identifies a subscribers response", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/shows/al-maximo/analytics/subscribers"
    );
    expect(result).toEqual({ type: "subscribers" });
  });

  it("identifies an overall response", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/shows/al-maximo/analytics/overall"
    );
    expect(result).toEqual({ type: "overall" });
  });

  it("identifies an apps response", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/shows/al-maximo/analytics/apps"
    );
    expect(result).toEqual({ type: "apps" });
  });

  it("identifies a countries_map response", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/shows/al-maximo/analytics/countries_map"
    );
    expect(result).toEqual({ type: "countriesMap" });
  });

  it("returns null for HTML-only endpoints like episodes", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/shows/al-maximo/analytics/episodes?analytics%5Btimeframe%5D=first_thirty"
    );
    expect(result).toBeNull();
  });

  it("returns null for non-analytics URLs", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/shows/al-maximo/settings"
    );
    expect(result).toBeNull();
  });
});
