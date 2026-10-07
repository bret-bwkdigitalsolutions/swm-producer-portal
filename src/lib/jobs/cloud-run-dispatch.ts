import { GoogleAuth } from "google-auth-library";
import { mergeJobMetadata } from "./job-metadata";
import {
  buildCloudRunRunRequest,
  type VideoWorkerMode,
} from "./processing-runtime";

/**
 * Start one Cloud Run job execution for a distribution job.
 *
 * Auth is the invoker service account in CLOUD_RUN_INVOKER_CREDENTIALS_JSON.
 * That account can run this job and nothing else. The execution's own
 * service account reads the buckets and secrets. The request body carries
 * only the distribution job id and which phase to run.
 */
export async function dispatchVideoProcessing(
  jobId: string,
  mode: VideoWorkerMode
): Promise<string> {
  const raw = process.env.CLOUD_RUN_INVOKER_CREDENTIALS_JSON;
  if (!raw) {
    throw new Error(
      "CLOUD_RUN_INVOKER_CREDENTIALS_JSON is not set. Refusing to start a Cloud Run job without the invoker service account."
    );
  }
  let credentials: object;
  try {
    credentials = JSON.parse(raw) as object;
  } catch {
    throw new Error("CLOUD_RUN_INVOKER_CREDENTIALS_JSON is not valid JSON.");
  }

  const { url, body } = buildCloudRunRunRequest(jobId, mode);
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) {
    throw new Error("Cloud Run invoker returned an empty access token.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Cloud Run job start failed (${response.status}): ${text.slice(0, 500)}`
    );
  }

  const data = (await response.json()) as { name?: string };
  const execution = typeof data.name === "string" ? data.name : "";
  await mergeJobMetadata(jobId, {
    processingRuntime: "cloudrun",
    processingExecution: execution,
    videoWorkerMode: mode,
    workerHeartbeat: new Date().toISOString(),
  });
  console.log(
    `[cloud-run] Dispatched ${mode} for job ${jobId} as ${execution || "(no execution name)"}`
  );
  return execution;
}
