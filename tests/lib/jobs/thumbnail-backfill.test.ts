import { describe, it, expect, vi, beforeEach } from "vitest";

const mockJobFindUnique = vi.fn();
const mockJobUpdate = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => {
  const dbMock: Record<string, unknown> = {
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

const mockUploadBuffer = vi.fn();
vi.mock("@/lib/gcs", () => ({ uploadBuffer: (...a: unknown[]) => mockUploadBuffer(...a) }));

const mockPrepareForWordPress = vi.fn();
const mockPrepareTransistorImageUrl = vi.fn();
vi.mock("@/lib/image", () => ({
  prepareForWordPress: (...a: unknown[]) => mockPrepareForWordPress(...a),
  prepareTransistorImageUrl: (...a: unknown[]) => mockPrepareTransistorImageUrl(...a),
}));

const mockGetPost = vi.fn();
const mockUpdatePost = vi.fn();
const mockUploadMedia = vi.fn();
vi.mock("@/lib/wordpress/client", () => ({
  getPost: (...a: unknown[]) => mockGetPost(...a),
  updatePost: (...a: unknown[]) => mockUpdatePost(...a),
  uploadMedia: (...a: unknown[]) => mockUploadMedia(...a),
}));

import {
  backfillThumbnail,
  thumbnailBackfillConfig,
  waitForYouTubeThumbnail,
} from "@/lib/jobs/thumbnail-backfill";

type Reply = { status: number; body?: unknown };
function res({ status, body }: Reply) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => "",
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  };
}

let persisted: Record<string, unknown>;
const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function installFetch(handler: (url: string, init?: RequestInit) => Reply) {
  fetchCalls.length = 0;
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    return res(handler(url, init));
  }) as unknown as typeof fetch;
}

const ytVideo = (availability: string) => ({
  status: 200,
  body: {
    items: [
      {
        snippet: { thumbnails: { maxres: { url: "https://i.ytimg.com/vi/yt1/maxresdefault.jpg" } } },
        processingDetails: { processingStatus: availability === "available" ? "succeeded" : "processing", thumbnailsAvailability: availability },
      },
    ],
  },
});

function job(metadata: Record<string, unknown> = {}, platforms?: unknown[]) {
  return {
    id: "job-1",
    title: "Episode 1",
    wpShowId: 42,
    metadata,
    platforms: platforms ?? [
      { platform: "youtube", status: "completed", externalId: "yt1" },
      { platform: "website", status: "completed", externalId: "7" },
      { platform: "transistor", status: "completed", externalId: "ep1" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  thumbnailBackfillConfig.sleep = async () => {};
  thumbnailBackfillConfig.pollDelaysMs = [0, 0, 0];
  persisted = {};
  mockQueryRaw.mockImplementation(async () => [{ metadata: persisted }]);
  mockJobUpdate.mockImplementation(async ({ data }: { data: { metadata: Record<string, unknown> } }) => {
    persisted = data.metadata;
    return {};
  });
  mockGetYouTubeAccessToken.mockResolvedValue("yt-token");
  mockGetTransistorApiKey.mockResolvedValue("tr-key");
  mockUploadBuffer.mockResolvedValue("uploads/yt-thumb-yt1.jpg");
  mockPrepareForWordPress.mockResolvedValue({ buffer: Buffer.from([1]), contentType: "image/jpeg", width: 1200, height: 675 });
  mockPrepareTransistorImageUrl.mockResolvedValue("https://signed/square.jpg");
  mockGetPost.mockResolvedValue({ id: 7, featured_media: 0 });
  mockUploadMedia.mockResolvedValue({ id: 555 });
  mockUpdatePost.mockResolvedValue({});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("waitForYouTubeThumbnail", () => {
  it("polls the YouTube API until thumbnails are available, then downloads the best one", async () => {
    let apiCalls = 0;
    installFetch((url) => {
      if (url.includes("googleapis.com")) {
        apiCalls++;
        return ytVideo(apiCalls < 3 ? "inProgress" : "available");
      }
      return { status: 200 };
    });
    const thumb = await waitForYouTubeThumbnail("yt1", 42);
    expect(thumb?.source).toBe("youtube_api");
    expect(thumb?.attempts).toBe(3);
    expect(thumb?.url).toContain("maxresdefault");
  });

  it("falls back to public thumbnail URLs when the API can't see the video", async () => {
    installFetch((url) => {
      if (url.includes("googleapis.com")) return { status: 403 };
      if (url.includes("maxresdefault")) return { status: 404 };
      return { status: 200 };
    });
    const thumb = await waitForYouTubeThumbnail("yt1", 42);
    expect(thumb?.source).toBe("youtube_public");
    expect(thumb?.url).toContain("sddefault");
  });

  it("gives up after the configured attempts", async () => {
    installFetch((url) => (url.includes("googleapis.com") ? ytVideo("inProgress") : { status: 404 }));
    expect(await waitForYouTubeThumbnail("yt1", 42)).toBeNull();
  });
});

describe("backfillThumbnail", () => {
  it("fetches the YouTube thumbnail and sets the website featured image and Transistor artwork", async () => {
    mockJobFindUnique.mockResolvedValue(job());
    installFetch((url, init) => {
      if (url.includes("googleapis.com")) return ytVideo("available");
      if (url.includes("api.transistor.fm") && init?.method === "PATCH") return { status: 200 };
      if (url.includes("api.transistor.fm")) return { status: 200, body: { data: { attributes: { image_url: null } } } };
      return { status: 200 };
    });

    const state = await backfillThumbnail("job-1");

    expect(state?.status).toBe("done");
    expect(state?.steps).toEqual({ website: "set", transistor: "set" });
    expect(mockUploadBuffer).toHaveBeenCalledWith("yt-thumb-yt1.jpg", expect.any(Buffer), "image/jpeg");
    expect(persisted.thumbnailGcsPath).toBe("uploads/yt-thumb-yt1.jpg");
    expect(mockUpdatePost).toHaveBeenCalledWith("episode", 7, { featured_media: 555 });
    const patch = fetchCalls.find((c) => c.init?.method === "PATCH")!;
    expect(patch.url).toContain("/episodes/ep1");
    expect(JSON.parse(String(patch.init!.body))).toEqual({ episode: { image_url: "https://signed/square.jpg" } });
    expect((persisted.thumbnailBackfill as { status: string }).status).toBe("done");
  });

  it("leaves images that are already set alone", async () => {
    mockJobFindUnique.mockResolvedValue(job({ thumbnailGcsPath: "uploads/existing.jpg" }));
    mockGetPost.mockResolvedValue({ id: 7, featured_media: 99 });
    installFetch(() => ({ status: 200, body: { data: { attributes: { image_url: "https://img" } } } }));

    const state = await backfillThumbnail("job-1");

    expect(state?.source).toBe("existing");
    expect(state?.steps).toEqual({ website: "already_set", transistor: "already_set" });
    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(fetchCalls.some((c) => c.init?.method === "PATCH")).toBe(false);
  });

  it("records a warning and continues when one platform update fails", async () => {
    mockJobFindUnique.mockResolvedValue(job({ thumbnailGcsPath: "uploads/existing.jpg" }));
    mockUploadMedia.mockRejectedValue(new Error("WP media 500"));
    installFetch((url, init) =>
      init?.method === "PATCH" ? { status: 200 } : { status: 200, body: { data: { attributes: { image_url: null } } } }
    );

    const state = await backfillThumbnail("job-1");

    expect(state?.status).toBe("partial");
    expect(state?.steps).toEqual({ website: "failed", transistor: "set" });
    const issues = persisted.distributionIssues as Array<{ platform: string; severity: string; message: string }>;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ platform: "website", severity: "warning" });
    expect(issues[0].message).toContain("WP media 500");
  });

  it("records a warning when the YouTube thumbnail never becomes available", async () => {
    mockJobFindUnique.mockResolvedValue(job());
    installFetch((url) => (url.includes("googleapis.com") ? ytVideo("inProgress") : { status: 404 }));

    const state = await backfillThumbnail("job-1");

    expect(state?.status).toBe("failed");
    expect(mockUpdatePost).not.toHaveBeenCalled();
    const issues = persisted.distributionIssues as Array<{ source: string; severity: string }>;
    expect(issues[0]).toMatchObject({ source: "thumbnail_backfill", severity: "warning" });
  });

  it("also sets artwork on the network Transistor episode", async () => {
    mockJobFindUnique.mockResolvedValue(
      job({ thumbnailGcsPath: "uploads/existing.jpg", networkTransistorEpisodeId: "net-9" }, [
        { platform: "youtube", status: "completed", externalId: "yt1" },
        { platform: "transistor", status: "completed", externalId: "ep1" },
      ])
    );
    installFetch((url, init) =>
      init?.method === "PATCH" ? { status: 200 } : { status: 200, body: { data: { attributes: { image_url: null } } } }
    );

    const state = await backfillThumbnail("job-1");

    expect(state?.steps).toEqual({ transistor: "set", transistor_network: "set" });
    expect(mockGetTransistorApiKey).toHaveBeenCalledWith(0);
  });
});
