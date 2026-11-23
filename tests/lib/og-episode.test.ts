import { describe, expect, it } from "vitest";
import {
  metadataForJobDetail,
  parseOgTransistorShowId,
  transistorPublishSchedule,
} from "@/lib/og-episode";

describe("metadataForJobDetail", () => {
  it("drops the Vimeo privacy-hash URL before the job page is serialized", () => {
    const metadata = metadataForJobDetail({
      description: "Members only",
      premiumSection: "og",
      ogVimeoVideoId: "555",
      ogVimeoUrl: "https://vimeo.com/555/abc123",
      ogVimeoMediaUrl: "https://vimeo.com/555/abc123",
    });

    expect(metadata.ogVimeoMediaUrl).toBeUndefined();
    expect(metadata.ogVimeoUrl).toBeUndefined();
    expect(metadata.ogVimeoVideoId).toBe("555");
    expect(metadata.description).toBe("Members only");
    expect(JSON.stringify(metadata)).not.toContain("abc123");
  });
});

describe("parseOgTransistorShowId", () => {
  it("accepts a numeric id or a slug and clears a blank value", () => {
    expect(parseOgTransistorShowId(" 44120 ")).toEqual({ ok: true, id: "44120" });
    expect(parseOgTransistorShowId("the-og")).toEqual({ ok: true, id: "the-og" });
    expect(parseOgTransistorShowId("  ")).toEqual({ ok: true, id: null });
    expect(parseOgTransistorShowId("https://dashboard.transistor.fm/shows/the-og").ok).toBe(
      false
    );
  });
});

describe("transistorPublishSchedule", () => {
  const now = Date.parse("2026-11-23T12:00:00.000Z");

  it("publishes now when the date is missing or already in the past", () => {
    expect(transistorPublishSchedule("now", "2099-01-01T00:00:00.000Z", now)).toBeUndefined();
    expect(transistorPublishSchedule("schedule", null, now)).toBeUndefined();
    expect(
      transistorPublishSchedule("schedule", "2026-11-23T11:59:00.000Z", now)
    ).toBeUndefined();
  });

  it("keeps a future schedule", () => {
    expect(
      transistorPublishSchedule("schedule", "2026-11-24T15:00:00.000Z", now)
    ).toBe("2026-11-24T15:00:00.000Z");
  });
});
