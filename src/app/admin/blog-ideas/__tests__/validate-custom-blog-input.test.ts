import { describe, it, expect } from "vitest";
import { validateCustomBlogInput } from "../validate-custom-blog-input";

describe("validateCustomBlogInput", () => {
  it("accepts a valid show + brief", () => {
    expect(
      validateCustomBlogInput({ wpShowId: 42, customPrompt: "Write about X" })
    ).toEqual({ ok: true });
  });

  it("accepts show + brief + jobId", () => {
    expect(
      validateCustomBlogInput({
        wpShowId: 42,
        customPrompt: "Write about X",
        jobId: "abc123",
      })
    ).toEqual({ ok: true });
  });

  it("rejects non-integer show id", () => {
    const result = validateCustomBlogInput({
      wpShowId: Number.NaN,
      customPrompt: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/show/i);
  });

  it("rejects zero or negative show id", () => {
    expect(
      validateCustomBlogInput({ wpShowId: 0, customPrompt: "x" }).ok
    ).toBe(false);
    expect(
      validateCustomBlogInput({ wpShowId: -1, customPrompt: "x" }).ok
    ).toBe(false);
  });

  it("rejects empty or whitespace-only brief", () => {
    const empty = validateCustomBlogInput({ wpShowId: 42, customPrompt: "" });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.message).toMatch(/brief/i);

    const whitespace = validateCustomBlogInput({
      wpShowId: 42,
      customPrompt: "   \n  ",
    });
    expect(whitespace.ok).toBe(false);
  });

  it("rejects a blank string jobId (empty after trim)", () => {
    const result = validateCustomBlogInput({
      wpShowId: 42,
      customPrompt: "x",
      jobId: "   ",
    });
    expect(result.ok).toBe(false);
  });
});
