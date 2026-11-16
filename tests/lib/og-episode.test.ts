import { describe, expect, it } from "vitest";
import { metadataForJobDetail } from "@/lib/og-episode";

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
