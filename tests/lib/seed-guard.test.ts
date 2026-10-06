import { describe, it, expect } from "vitest";
import { assertSeedAllowed, seedPassword } from "@/lib/seed-guard";

describe("seed guard", () => {
  it("refuses to run in production", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(/production/);
    expect(() => assertSeedAllowed({ NODE_ENV: "development", RAILWAY_ENVIRONMENT_NAME: "production" })).toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertSeedAllowed({ RAILWAY_ENVIRONMENT_NAME: "staging" })).not.toThrow();
  });

  it("uses the env password or generates a random one — never a hardcoded default", () => {
    expect(seedPassword("SEED_ADMIN_PASSWORD", { SEED_ADMIN_PASSWORD: "a-long-enough-pass" })).toEqual({
      password: "a-long-enough-pass",
      generated: false,
    });
    const a = seedPassword("SEED_ADMIN_PASSWORD", {});
    const b = seedPassword("SEED_ADMIN_PASSWORD", {});
    expect(a.generated).toBe(true);
    expect(a.password).not.toBe(b.password);
    expect(a.password.length).toBeGreaterThanOrEqual(20);
    expect(["admin123", "producer123"]).not.toContain(a.password);
    expect(() => seedPassword("SEED_ADMIN_PASSWORD", { SEED_ADMIN_PASSWORD: "short" })).toThrow();
  });
});
