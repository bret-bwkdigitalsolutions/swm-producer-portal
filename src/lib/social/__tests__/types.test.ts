import { describe, it, expect } from "vitest";
import {
  isSocialPlatform,
  isSocialAccountKind,
  assertValidKindFields,
} from "../types";

describe("isSocialPlatform", () => {
  it("accepts the four supported platforms", () => {
    expect(isSocialPlatform("facebook_page")).toBe(true);
    expect(isSocialPlatform("instagram")).toBe(true);
    expect(isSocialPlatform("tiktok")).toBe(true);
    expect(isSocialPlatform("x")).toBe(true);
  });

  it("rejects unknown platforms", () => {
    expect(isSocialPlatform("threads")).toBe(false);
    expect(isSocialPlatform("twitter")).toBe(false);
    expect(isSocialPlatform("")).toBe(false);
  });
});

describe("isSocialAccountKind", () => {
  it("accepts show, host, and network", () => {
    expect(isSocialAccountKind("show")).toBe(true);
    expect(isSocialAccountKind("host")).toBe(true);
    expect(isSocialAccountKind("network")).toBe(true);
  });

  it("rejects unknown kinds", () => {
    expect(isSocialAccountKind("admin")).toBe(false);
  });
});

describe("assertValidKindFields", () => {
  it("passes when kind=show has wpShowId", () => {
    expect(() => assertValidKindFields("show", 27, null)).not.toThrow();
  });

  it("throws when kind=show is missing wpShowId", () => {
    expect(() => assertValidKindFields("show", null, null)).toThrow(
      /wpShowId/
    );
    expect(() => assertValidKindFields("show", undefined, null)).toThrow(
      /wpShowId/
    );
  });

  it("passes when kind=host has hostName", () => {
    expect(() =>
      assertValidKindFields("host", null, "John Henry")
    ).not.toThrow();
  });

  it("throws when kind=host is missing hostName", () => {
    expect(() => assertValidKindFields("host", null, null)).toThrow(
      /hostName/
    );
    expect(() => assertValidKindFields("host", null, "")).toThrow(/hostName/);
  });

  it("passes when kind=network has neither wpShowId nor hostName", () => {
    expect(() => assertValidKindFields("network", null, null)).not.toThrow();
  });

  it("throws on unknown kind", () => {
    expect(() => assertValidKindFields("admin", null, null)).toThrow(
      /Invalid SocialAccount kind/
    );
  });
});
