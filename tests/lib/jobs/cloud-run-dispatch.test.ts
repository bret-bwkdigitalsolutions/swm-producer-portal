import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAccessToken = vi.fn();
const mockMerge = vi.fn();
const constructed: unknown[] = [];

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    constructor(opts: unknown) {
      constructed.push(opts);
    }
    getClient() {
      return { getAccessToken: mockGetAccessToken };
    }
  },
}));

vi.mock("@/lib/jobs/job-metadata", () => ({
  mergeJobMetadata: (...args: unknown[]) => mockMerge(...args),
}));

import { dispatchVideoProcessing } from "@/lib/jobs/cloud-run-dispatch";

beforeEach(() => {
  constructed.length = 0;
  mockGetAccessToken.mockReset();
  mockMerge.mockReset();
  mockMerge.mockResolvedValue(undefined);
  mockGetAccessToken.mockResolvedValue({ token: "ya29.test" });
  process.env.CLOUD_RUN_JOB =
    "projects/swm-producer-portal/locations/us-central1/jobs/swm-video-processor";
  process.env.CLOUD_RUN_INVOKER_CREDENTIALS_JSON = JSON.stringify({
    client_email: "invoker@swm-producer-portal.iam.gserviceaccount.com",
    private_key: "test-key",
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.CLOUD_RUN_JOB;
  delete process.env.CLOUD_RUN_INVOKER_CREDENTIALS_JSON;
  vi.unstubAllGlobals();
});

describe("dispatchVideoProcessing", () => {
  it("starts the job with the invoker token and records the execution", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: "projects/swm-producer-portal/locations/us-central1/jobs/swm-video-processor/executions/abc",
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const execution = await dispatchVideoProcessing("job-9", "analyze");

    expect(execution).toContain("/executions/abc");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://run.googleapis.com/v2/projects/swm-producer-portal/locations/us-central1/jobs/swm-video-processor:run",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer ya29.test" }),
      })
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.overrides.containerOverrides[0].env).toEqual([
      { name: "VIDEO_WORKER_JOB_ID", value: "job-9" },
      { name: "VIDEO_WORKER_MODE", value: "analyze" },
    ]);
    expect(mockMerge).toHaveBeenCalledWith(
      "job-9",
      expect.objectContaining({
        processingRuntime: "cloudrun",
        processingExecution: execution,
        videoWorkerMode: "analyze",
      })
    );
    const authOpts = constructed[0] as { scopes: string[]; credentials: { client_email: string } };
    expect(authOpts.credentials.client_email).toContain("invoker@");
    expect(authOpts.scopes).toEqual(["https://www.googleapis.com/auth/cloud-platform"]);
  });

  it("does not record a dispatch when Cloud Run rejects the start", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "permission denied",
        json: async () => ({}),
      })
    );

    await expect(dispatchVideoProcessing("job-9", "process")).rejects.toThrow(/403/);
    expect(mockMerge).not.toHaveBeenCalled();
  });

  it("refuses to start when the invoker key is missing", async () => {
    delete process.env.CLOUD_RUN_INVOKER_CREDENTIALS_JSON;
    await expect(dispatchVideoProcessing("job-9", "process")).rejects.toThrow(
      /CLOUD_RUN_INVOKER_CREDENTIALS_JSON/
    );
  });
});
