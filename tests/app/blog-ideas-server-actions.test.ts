import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Every export of a "use server" module is a server action that can be called
// directly over HTTP. Internal helpers without their own auth check must not
// be exported from there.
describe("admin/blog-ideas server actions", () => {
  const actionsPath = join(__dirname, "../../src/app/admin/blog-ideas/actions.ts");
  const src = readFileSync(actionsPath, "utf8");

  it("does not export the unauthenticated helpers", () => {
    expect(src.startsWith('"use server"')).toBe(true);
    for (const name of ["loadStyleContext", "createBlogDraftArtifacts", "runSuggestionBlogAi"]) {
      expect(src).not.toMatch(new RegExp(`export\\s+async\\s+function\\s+${name}\\b`));
      expect(src).not.toMatch(new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`));
    }
  });

  it("guards every exported async action with requireAdmin()", () => {
    const re = /export\s+async\s+function\s+(\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g;
    const unguarded: string[] = [];
    const found: string[] = [];
    for (const m of src.matchAll(re)) {
      found.push(m[1]);
      if (!m[2].includes("await requireAdmin()")) unguarded.push(m[1]);
    }
    expect(found).toEqual(expect.arrayContaining(["generateBlogPost", "generateCustomBlogPost", "listEpisodeOptions"]));
    expect(unguarded).toEqual([]);
  });
});
