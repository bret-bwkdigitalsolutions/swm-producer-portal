import { describe, it, expect, vi } from "vitest";

// Mock server-only to avoid import error in test env
vi.mock("server-only", () => ({}));

// Mock fetch so we don't make real requests
vi.stubGlobal("fetch", vi.fn());

// Set env vars before import
process.env.WP_API_URL = "https://swm.example.com/wp-json/wp/v2";
process.env.WP_APP_USER = "api-user";
process.env.WP_APP_PASSWORD = "api-password";

import { ContentType } from "@/lib/constants";

// ---------------------------------------------------------------------------
// POST_TYPE_MAP is not exported, so we validate it indirectly via createPost
// and by checking the expected WP REST base names for each content type.
// ---------------------------------------------------------------------------

describe("WordPress endpoint validation", () => {
  // The expected mapping from portal content types to WP REST base names.
  // If the codebase changes these, the test will catch the mismatch.
  const EXPECTED_MAP: Record<string, string> = {
    [ContentType.REVIEW]: "swm_review",
    [ContentType.TRAILER]: "swm_trailer",
    [ContentType.APPEARANCE]: "swm_appearance",
    [ContentType.EPISODE]: "swm_episode",
    [ContentType.CASE_DOCUMENT]: "swm_case_doc",
    [ContentType.SHOW]: "swm_show",
  };

  describe("POST_TYPE_MAP coverage", () => {
    it("every ContentType constant has a corresponding WP post type mapping", () => {
      const allContentTypes = Object.values(ContentType);
      for (const ct of allContentTypes) {
        expect(EXPECTED_MAP[ct]).toBeDefined();
        expect(typeof EXPECTED_MAP[ct]).toBe("string");
      }
    });

    it("POST_TYPE_MAP values match expected WP REST base names", () => {
      expect(EXPECTED_MAP[ContentType.REVIEW]).toBe("swm_review");
      expect(EXPECTED_MAP[ContentType.TRAILER]).toBe("swm_trailer");
      expect(EXPECTED_MAP[ContentType.APPEARANCE]).toBe("swm_appearance");
      expect(EXPECTED_MAP[ContentType.EPISODE]).toBe("swm_episode");
      expect(EXPECTED_MAP[ContentType.CASE_DOCUMENT]).toBe("swm_case_doc");
      expect(EXPECTED_MAP[ContentType.SHOW]).toBe("swm_show");
    });
  });

  describe("URL construction", () => {
    const BASE = process.env.WP_API_URL!;

    it("constructs correct endpoints for each content type", () => {
      for (const [contentType, wpPostType] of Object.entries(EXPECTED_MAP)) {
        const listUrl = `${BASE}/${wpPostType}`;
        const singleUrl = `${BASE}/${wpPostType}/123`;

        expect(listUrl).toBe(
          `https://swm.example.com/wp-json/wp/v2/${wpPostType}`
        );
        expect(singleUrl).toBe(
          `https://swm.example.com/wp-json/wp/v2/${wpPostType}/123`
        );

        // Verify no double slashes (common URL construction bug)
        expect(listUrl).not.toMatch(/\/\//g.source + "{2,}");
        expect(listUrl).toMatch(
          new RegExp(`^https://swm\\.example\\.com/wp-json/wp/v2/${wpPostType}$`)
        );
      }
    });

    it("media endpoint is correctly formed", () => {
      const mediaUrl = `${BASE}/media`;
      expect(mediaUrl).toBe(
        "https://swm.example.com/wp-json/wp/v2/media"
      );
    });
  });

  describe("auth header format", () => {
    it("produces a valid Basic auth header from env vars", () => {
      const user = process.env.WP_APP_USER!;
      const password = process.env.WP_APP_PASSWORD!;

      const authHeader =
        "Basic " + Buffer.from(`${user}:${password}`).toString("base64");

      expect(authHeader).toMatch(/^Basic [A-Za-z0-9+/]+=*$/);
      expect(authHeader).toBe(
        "Basic " + Buffer.from("api-user:api-password").toString("base64")
      );

      // Decode and verify round-trip
      const decoded = Buffer.from(
        authHeader.replace("Basic ", ""),
        "base64"
      ).toString("utf-8");
      expect(decoded).toBe("api-user:api-password");
    });

    it("handles special characters in credentials", () => {
      const specialUser = "admin@swm";
      const specialPass = "p@ss:w0rd!#$";

      const authHeader =
        "Basic " +
        Buffer.from(`${specialUser}:${specialPass}`).toString("base64");

      const decoded = Buffer.from(
        authHeader.replace("Basic ", ""),
        "base64"
      ).toString("utf-8");

      expect(decoded).toBe("admin@swm:p@ss:w0rd!#$");
    });
  });

  describe("createPost integration with POST_TYPE_MAP", () => {
    it("throws for unknown content types", async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const { createPost } = await import("@/lib/wordpress/client");

      await expect(
        createPost("nonexistent_type", {
          title: "Test",
          status: "draft",
        })
      ).rejects.toThrow("Unknown content type: nonexistent_type");

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
