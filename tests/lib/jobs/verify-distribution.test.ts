import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPlatformFindMany = vi.fn();
const mockJobFindUnique = vi.fn();
const mockJobUpdate = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => {
  const dbMock: Record<string, unknown> = {
    distributionJobPlatform: { findMany: (...a: unknown[]) => mockPlatformFindMany(...a) },
    distributionJob: {
      findUnique: (...a: unknown[]) => mockJobFindUnique(...a),
      update: (...a: unknown[]) => mockJobUpdate(...a),
    },
    $queryRaw: (...a: unknown[]) => mockQueryRaw(...a),
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(dbMock),
  };
  return { db: dbMock };
});

const mockGetYouTubeAccessToken = vi.fn();
const mockGetTransistorApiKey = vi.fn();
vi.mock("@/lib/analytics/credentials", () => ({
  getYouTubeAccessToken: (...a: unknown[]) => mockGetYouTubeAccessToken(...a),
  getTransistorApiKey: (...a: unknown[]) => mockGetTransistorApiKey(...a),
}));

import { runVerificationTier, groupsForTier } from "@/lib/jobs/verify-distribution";
import { platformFetchConfig } from "@/lib/jobs/platform-fetch";
import { computeVerdict, issueSeverity, type TierResult } from "@/lib/jobs/verification-types";

// ---------------------------------------------------------------------------
// Fake platform APIs
// ---------------------------------------------------------------------------

type Reply = { status: number; body?: unknown };
type Handler = (url: string, init?: RequestInit) => Reply | Reply[];

function res({ status, body }: Reply) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: null,
    json: async () => body,
    text: async () => JSON.stringify(body ?? ""),
  };
}

/** Route fetch by URL substring. An array reply is consumed one per call. */
function installFetch(routes: Record<string, Handler>) {
  const queues = new Map<string, Reply[]>();
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    for (const [key, handler] of Object.entries(routes)) {
      if (!url.includes(key)) continue;
      if (!queues.has(key)) {
        const r = handler(url, init);
        if (Array.isArray(r)) queues.set(key, [...r]);
        else return res(r);
      }
      const q = queues.get(key)!;
      return res(q.length > 1 ? q.shift()! : q[0]);
    }
    return res({ status: 200 });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const TITLE = "Episode 12: The Lake";

const youtubeOk = (overrides: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    items: [
      {
        snippet: { title: TITLE, thumbnails: { high: { url: "x" } } },
        status: { uploadStatus: "processed", privacyStatus: "public" },
        ...overrides,
      },
    ],
  },
});

const transistorOk = (attrs: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    data: {
      attributes: {
        title: TITLE,
        image_url: "https://img/ep.jpg",
        status: "published",
        media_url: "https://media.transistor.fm/ep.mp3",
        share_url: "https://share.transistor.fm/s/abc",
        ...attrs,
      },
    },
  },
});

const wpOk = (fields: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    id: 7,
    title: { rendered: TITLE },
    featured_media: 99,
    status: "publish",
    link: "https://stolenwatermedia.com/episode/the-lake",
    ...fields,
  },
});

const PLATFORMS = [
  { platform: "youtube", status: "completed", externalId: "yt1" },
  { platform: "transistor", status: "completed", externalId: "ep1" },
  { platform: "website", status: "completed", externalId: "7" },
];

let persisted: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  platformFetchConfig.retryDelaysMs = [0, 0, 0];
  process.env.WP_API_URL = "https://wp.example/wp-json/wp/v2";
  process.env.WP_APP_USER = "u";
  process.env.WP_APP_PASSWORD = "p";
  mockGetYouTubeAccessToken.mockResolvedValue("yt-token");
  mockGetTransistorApiKey.mockResolvedValue("tr-key");
  mockPlatformFindMany.mockResolvedValue(PLATFORMS);
  mockJobFindUnique.mockResolvedValue({ metadata: {} });
  persisted = {};
  mockQueryRaw.mockImplementation(async () => [{ metadata: persisted }]);
  mockJobUpdate.mockImplementation(async ({ data }: { data: { metadata: Record<string, unknown> } }) => {
    persisted = data.metadata;
    return {};
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const allIssues = (r: TierResult) => r.platforms.flatMap((p) => p.issues);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runVerificationTier", () => {
  it("treats a missing thumbnail (no website featured image / no Transistor artwork) as warnings, not failures", async () => {
    installFetch({
      "googleapis.com/youtube": () => youtubeOk(),
      "api.transistor.fm": () => transistorOk({ image_url: null }),
      "wp.example": () => wpOk({ featured_media: 0 }),
    });

    const result = await runVerificationTier(5, "job-1", 42, TITLE);

    expect(result.platforms.every((p) => p.passed)).toBe(true);
    const issues = allIssues(result);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.severity === "warning" && i.field === "thumbnail")).toBe(true);
    expect(computeVerdict([result], [], 2).status).toBe("warnings");
  });

  it("does not accumulate checks across tiers — tier 4 only runs public-URL checks", async () => {
    const fetchMock = installFetch({
      "googleapis.com/youtube": () => youtubeOk({ snippet: { title: "WRONG TITLE" } }),
      "api.transistor.fm": () => transistorOk({ image_url: null }),
      "wp.example": () => wpOk({ featured_media: 0 }),
    });

    const result = await runVerificationTier(4, "job-1", 42, TITLE);

    // Title/thumbnail problems belong to tier 2, so tier 4 reports nothing.
    expect(allIssues(result)).toEqual([]);
    // It did check the public URLs.
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain("https://www.youtube.com/watch?v=yt1");
    expect(urls).toContain("https://stolenwatermedia.com/episode/the-lake");
    expect(urls).toContain("https://share.transistor.fm/s/abc");
  });

  it("tier 1 only checks existence", async () => {
    installFetch({
      "googleapis.com/youtube": () => youtubeOk({ snippet: { title: "WRONG" } }),
      "api.transistor.fm": () => transistorOk({ status: "draft", media_url: null }),
      "wp.example": () => wpOk({ status: "draft" }),
    });
    const result = await runVerificationTier(1, "job-1", 42, TITLE);
    expect(allIssues(result)).toEqual([]);
    expect(groupsForTier(1)).toEqual(new Set(["exists"]));
  });

  it("flags a title mismatch as critical", async () => {
    installFetch({
      "googleapis.com/youtube": () => youtubeOk(),
      "api.transistor.fm": () => transistorOk({ title: "Something else" }),
      "wp.example": () => wpOk(),
    });
    const result = await runVerificationTier(2, "job-1", 42, TITLE);
    const tr = result.platforms.find((p) => p.platform === "transistor")!;
    expect(tr.passed).toBe(false);
    expect(tr.issues[0]).toMatchObject({ field: "title", severity: "critical" });
  });

  it("retries a transient 503 and passes when the API recovers", async () => {
    const fetchMock = installFetch({
      "googleapis.com/youtube": () => youtubeOk(),
      "api.transistor.fm": () => [{ status: 503 }, transistorOk()],
      "wp.example": () => wpOk(),
    });
    const result = await runVerificationTier(2, "job-1", 42, TITLE);
    expect(result.platforms.every((p) => p.passed)).toBe(true);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("api.transistor.fm"))).toHaveLength(2);
  });

  it("marks a persistent 503 as a transient critical issue", async () => {
    installFetch({
      "googleapis.com/youtube": () => youtubeOk(),
      "api.transistor.fm": () => ({ status: 503 }),
      "wp.example": () => wpOk(),
    });
    const result = await runVerificationTier(2, "job-1", 42, TITLE);
    const tr = result.platforms.find((p) => p.platform === "transistor")!;
    expect(tr.passed).toBe(false);
    expect(tr.issues[0]).toMatchObject({ field: "api_check", severity: "critical", transient: true });
  });

  it("reports a deleted resource (404) as critical and not transient", async () => {
    installFetch({
      "googleapis.com/youtube": () => youtubeOk(),
      "api.transistor.fm": () => transistorOk(),
      "wp.example": () => ({ status: 404 }),
    });
    const result = await runVerificationTier(1, "job-1", 42, TITLE);
    const wp = result.platforms.find((p) => p.platform === "website")!;
    expect(wp.passed).toBe(false);
    expect(wp.issues[0]).toMatchObject({ actual: "not found (404)", severity: "critical" });
    expect(wp.issues[0].transient).toBeUndefined();
  });

  it("explains auth failures", async () => {
    installFetch({
      "googleapis.com/youtube": () => ({ status: 401 }),
      "api.transistor.fm": () => transistorOk(),
      "wp.example": () => wpOk(),
    });
    const result = await runVerificationTier(1, "job-1", 42, TITLE);
    const yt = result.platforms.find((p) => p.platform === "youtube")!;
    expect(yt.issues[0].actual).toMatch(/auth failed \(401\)/);
  });

  it("accepts draft status when the job was distributed as a draft", async () => {
    installFetch({
      "googleapis.com/youtube": () => youtubeOk(),
      "api.transistor.fm": () => transistorOk({ status: "draft" }),
      "wp.example": () => wpOk({ status: "draft" }),
    });
    const asDraft = await runVerificationTier(3, "job-1", 42, TITLE, { isDraft: true });
    expect(allIssues(asDraft)).toEqual([]);

    const notDraft = await runVerificationTier(3, "job-1", 42, TITLE);
    expect(allIssues(notDraft).map((i) => `${i.platform}.${i.field}`).sort()).toEqual([
      "transistor.status",
      "website.status",
    ]);
  });

  it("falls back to a ranged GET when a host rejects HEAD (405)", async () => {
    const fetchMock = installFetch({
      "googleapis.com/youtube": () => youtubeOk(),
      "api.transistor.fm": () => transistorOk(),
      "wp.example": () => wpOk(),
      "share.transistor.fm": (_url, init) => (init?.method === "HEAD" ? { status: 405 } : { status: 206 }),
    });
    // Only Transistor is completed for this job.
    mockPlatformFindMany.mockResolvedValue([PLATFORMS[1]]);
    const result = await runVerificationTier(4, "job-1", 42, TITLE);
    expect(allIssues(result)).toEqual([]);
    const shareCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("share.transistor.fm"));
    expect(shareCalls.map((c) => (c[1] as RequestInit).method)).toEqual(["HEAD", "GET"]);
  });

  it("flags YouTube processing failure as critical and still-processing as a warning", async () => {
    installFetch({
      "googleapis.com/youtube": () =>
        youtubeOk({ status: { uploadStatus: "rejected", rejectionReason: "duplicate" } }),
      "api.transistor.fm": () => transistorOk(),
      "wp.example": () => wpOk(),
    });
    let result = await runVerificationTier(3, "job-1", 42, TITLE);
    expect(result.platforms.find((p) => p.platform === "youtube")!.issues[0]).toMatchObject({
      field: "uploadStatus",
      actual: "rejected (duplicate)",
      severity: "critical",
    });

    installFetch({
      "googleapis.com/youtube": () => youtubeOk({ status: { uploadStatus: "uploaded" } }),
      "api.transistor.fm": () => transistorOk(),
      "wp.example": () => wpOk(),
    });
    result = await runVerificationTier(3, "job-1", 42, TITLE);
    const yt = result.platforms.find((p) => p.platform === "youtube")!;
    expect(yt.passed).toBe(true);
    expect(yt.issues[0].severity).toBe("warning");
  });

  it("also verifies the network Transistor cross-post with network credentials", async () => {
    mockJobFindUnique.mockResolvedValue({ metadata: { networkTransistorEpisodeId: "net-9" } });
    mockPlatformFindMany.mockResolvedValue([PLATFORMS[1]]);
    installFetch({
      "episodes/net-9": () => transistorOk({ title: "Different" }),
      "api.transistor.fm": () => transistorOk(),
    });
    const result = await runVerificationTier(2, "job-1", 42, TITLE);
    const net = result.platforms.find((p) => p.platform === "transistor_network")!;
    expect(net).toBeDefined();
    expect(net.passed).toBe(false);
    expect(mockGetTransistorApiKey).toHaveBeenCalledWith(0);
  });

  it("skips YouTube checks for live recordings", async () => {
    const fetchMock = installFetch({
      "api.transistor.fm": () => transistorOk(),
      "wp.example": () => wpOk(),
    });
    const result = await runVerificationTier(5, "job-1", 42, TITLE, { isLiveRecording: true });
    expect(result.platforms.find((p) => p.platform === "youtube")!.passed).toBe(true);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("googleapis"))).toBe(false);
  });

  it("persists each tier, replacing a previous run of the same tier", async () => {
    installFetch({
      "googleapis.com/youtube": () => youtubeOk(),
      "api.transistor.fm": () => transistorOk(),
      "wp.example": () => wpOk(),
    });
    await runVerificationTier(1, "job-1", 42, TITLE);
    await runVerificationTier(2, "job-1", 42, TITLE);
    await runVerificationTier(2, "job-1", 42, TITLE);
    const tiers = (persisted.verifications as TierResult[]).map((v) => v.tier);
    expect(tiers).toEqual([1, 2]);
  });
});

describe("computeVerdict", () => {
  const tier = (t: 1 | 2 | 3 | 4 | 5, issues: TierResult["platforms"][number]["issues"]): TierResult => ({
    tier: t,
    ranAt: "2026-10-06T15:00:00Z",
    platforms: [{ platform: "website", passed: !issues.some((i) => issueSeverity(i) === "critical"), issues }],
  });

  it("is pending until the final tier runs", () => {
    expect(computeVerdict([tier(1, []), tier(2, [])], [], 2).status).toBe("pending");
  });

  it("passes when the final tier is clean, even if earlier tiers saw problems", () => {
    const early = tier(2, [{ platform: "website", field: "title", expected: "a", actual: "b", severity: "critical" }]);
    expect(computeVerdict([early, tier(5, [])], [], 2).status).toBe("passed");
  });

  it("fails on critical distribution issues (e.g. network cross-post failed)", () => {
    const v = computeVerdict(
      [tier(5, [])],
      [{ source: "network_transistor", platform: "transistor_network", severity: "critical", message: "x", at: "" }],
      2
    );
    expect(v.status).toBe("failed");
    expect(v.critical).toHaveLength(1);
  });

  it("stays pending while a transient re-check is still outstanding", () => {
    const transient = tier(5, [
      { platform: "website", field: "api_check", expected: "accessible", actual: "API 503", severity: "critical", transient: true },
    ]);
    expect(computeVerdict([transient], [], 2, { awaitingTransientRecheck: true }).status).toBe("pending");
    expect(computeVerdict([transient], [], 2).status).toBe("failed");
  });

  it("infers severity for legacy results: thumbnail = warning, everything else = critical", () => {
    expect(issueSeverity({ field: "thumbnail" })).toBe("warning");
    expect(issueSeverity({ field: "title" })).toBe("critical");
    // Legacy job (no schedule version): tier 4 is final.
    const legacy = tier(4, [{ platform: "website", field: "thumbnail", expected: "set", actual: "none" }]);
    expect(computeVerdict([legacy], [], undefined).status).toBe("warnings");
  });
});
