import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/image", () => ({
  prepareForWordPress: vi.fn(),
}));
vi.mock("@/lib/wordpress/client", () => ({
  uploadMedia: vi.fn(),
  wpAuthorizationHeader: () => "Basic dGVzdA==",
}));

import { publishOgEpisodeDirect } from "@/lib/platforms/wordpress-og";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.WP_API_URL = "https://stolenwatermedia.com/wp-json/wp/v2";
  process.env.WP_APP_USER = "editor";
  process.env.WP_APP_PASSWORD = "app-password-secret";
});

describe("publishOgEpisodeDirect", () => {
  it("creates a members-only OG post and does not send a YouTube URL", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 880,
          url: "https://stolenwatermedia.com/shows/the-og/#swm-vimeo-555",
          created: true,
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    );

    const result = await publishOgEpisodeDirect({
      wpShowId: 21,
      title: "The OG #27",
      description: "A members-only hour.",
      chapters: "00:00 - Open\n10:00 - Close",
      transcript: "hello from the show",
      transcriptVtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nhello",
      vimeoVideoId: "555",
      mediaUrl: "https://vimeo.com/555/abc123",
      portalUserId: "user-1",
      portalJobId: "job-1",
      status: "publish",
    });

    expect(result).toEqual({
      postId: 880,
      postUrl: "https://stolenwatermedia.com/shows/the-og/#swm-vimeo-555",
      created: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://stolenwatermedia.com/wp-json/swm-premium/v1/og-content");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      title: "The OG #27",
      show_id: 21,
      section: "og",
      vimeo_video_id: "555",
      media_url: "https://vimeo.com/555/abc123",
      status: "publish",
      transcript: "hello from the show",
      portal_job_id: "job-1",
    });
    expect(body.content).toContain("A members-only hour.");
    expect(body.content).toContain("Open");
    expect(JSON.stringify(body)).not.toContain("youtube");
    expect(String(init.headers && new Headers(init.headers).get("authorization"))).toBe(
      "Basic dGVzdA=="
    );
    expect(JSON.stringify(init)).not.toContain("app-password-secret");
  });
});
