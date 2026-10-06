import { describe, it, expect } from "vitest";
import nextConfig from "../next.config";

describe("security headers", () => {
  it("sends HSTS, anti-framing, nosniff and referrer policy on every route", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    const h = Object.fromEntries(all!.headers.map((x) => [x.key, x.value]));
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=31536000/);
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    // The fuller policy is report-only so it can't break pages yet.
    expect(h["Content-Security-Policy-Report-Only"]).toContain("default-src 'self'");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
