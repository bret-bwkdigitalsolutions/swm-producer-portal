import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpsertCredential = vi.fn();
const mockUpsertShow = vi.fn();
const mockGetShow = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "admin", role: "admin" } })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    platformCredential: { upsert: (...args: unknown[]) => mockUpsertCredential(...args) },
    showMetadata: { upsert: (...args: unknown[]) => mockUpsertShow(...args) },
  },
}));

vi.mock("@/lib/wordpress/client", () => ({
  getShow: (...args: unknown[]) => mockGetShow(...args),
}));

import { saveCredential } from "@/app/admin/credentials/actions";
import { updateOgTransistorShow } from "@/app/admin/shows/actions";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("OG admin show guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertCredential.mockResolvedValue({});
    mockUpsertShow.mockResolvedValue({});
  });

  it("saves a Vimeo token on Your Dark Companion and refuses another show", async () => {
    const saved = await saveCredential(
      {},
      form({
        wpShowId: "21",
        platform: "vimeo",
        credentialType: "api_key",
        apiKey: "vimeo-token-value",
      })
    );
    expect(saved.success).toBe(true);
    expect(mockGetShow).not.toHaveBeenCalled();
    expect(mockUpsertCredential).toHaveBeenCalledTimes(1);

    mockGetShow.mockResolvedValue({ id: 22, title: { rendered: "The Clubhouse" } });
    const refused = await saveCredential(
      {},
      form({
        wpShowId: "22",
        platform: "vimeo",
        credentialType: "api_key",
        apiKey: "vimeo-token-value",
      })
    );
    expect(refused.success).toBe(false);
    expect(refused.message).toMatch(/Your Dark Companion/);
    expect(mockUpsertCredential).toHaveBeenCalledTimes(1);
  });

  it("saves the OG private show only when the show can host The OG", async () => {
    const saved = await updateOgTransistorShow(
      {},
      form({ wpShowId: "21", ogTransistorShowId: "the-og" })
    );
    expect(saved.success).toBe(true);
    expect(mockUpsertShow).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { ogTransistorShowId: "the-og" },
      })
    );

    mockGetShow.mockResolvedValue({ id: 22, title: { rendered: "The Clubhouse" } });
    const refused = await updateOgTransistorShow(
      {},
      form({ wpShowId: "22", ogTransistorShowId: "the-og" })
    );
    expect(refused.success).toBe(false);
    expect(mockUpsertShow).toHaveBeenCalledTimes(1);
  });
});
