import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAccountConfig } from "./auth.js";

describe("getAccountConfig", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns sunset config when env vars are set", () => {
    vi.stubEnv("TRANSISTOR_SUNSET_EMAIL", "test@example.com");
    vi.stubEnv("TRANSISTOR_SUNSET_PASSWORD", "secret");

    const config = getAccountConfig("sunset_lounge");
    expect(config).toEqual({
      name: "sunset_lounge",
      email: "test@example.com",
      password: "secret",
      storageStatePath: "transistor-auth-sunset_lounge.json",
    });
  });

  it("returns ydc config when env vars are set", () => {
    vi.stubEnv("TRANSISTOR_YDC_EMAIL", "ydc@example.com");
    vi.stubEnv("TRANSISTOR_YDC_PASSWORD", "ydcsecret");

    const config = getAccountConfig("ydc");
    expect(config).toEqual({
      name: "ydc",
      email: "ydc@example.com",
      password: "ydcsecret",
      storageStatePath: "transistor-auth-ydc.json",
    });
  });

  it("throws if env vars are missing", () => {
    expect(() => getAccountConfig("sunset_lounge")).toThrow(
      "Missing credentials"
    );
  });
});
