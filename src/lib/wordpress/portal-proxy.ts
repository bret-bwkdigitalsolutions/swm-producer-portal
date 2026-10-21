import "server-only";
import { isVideoWorker } from "@/lib/jobs/processing-runtime";
import {
  WordPressBlockedError,
  WpApiError,
  WpConfigError,
} from "@/lib/wordpress/types";

/**
 * Cloud Run gives every execution a new egress address, and the site
 * firewall blocks those. The Railway portal has a fixed IP, so the worker
 * asks the portal to call WordPress. `JOB_PROCESSING_SECRET` is the same
 * bearer token as `/api/jobs/process`.
 */
export const PORTAL_WORDPRESS_PATH = "/api/jobs/wordpress";

/**
 * The worker aborts the portal call at 90s. verifyEpisode keeps its own
 * WordPress read and public HEAD inside a 60s budget so this abort wins
 * only when the portal itself is stuck.
 */
export const PORTAL_WORDPRESS_TIMEOUT_MS = 90_000;

/**
 * Process-global count of `/api/jobs/wordpress` dispatches on this Node
 * process. That is safe because the Railway portal never sets VIDEO_WORKER,
 * so `shouldProxyWordPress()` stays false there. The Cloud Run worker calls
 * the portal over HTTP and keeps its own counter in a different process.
 */
let portalDispatchDepth = 0;

/** True while this process is handling `/api/jobs/wordpress`. Prevents a loop. */
export function isPortalDispatching(): boolean {
  return portalDispatchDepth > 0;
}

export async function runOnPortal<T>(fn: () => Promise<T>): Promise<T> {
  portalDispatchDepth += 1;
  try {
    return await fn();
  } finally {
    portalDispatchDepth -= 1;
  }
}

export function shouldProxyWordPress(): boolean {
  return isVideoWorker() && portalDispatchDepth === 0;
}

export interface SerializedPortalError {
  name: string;
  message: string;
  status?: number;
  endpoint?: string;
  body?: string;
}

export function serializePortalError(error: unknown): SerializedPortalError {
  if (error instanceof WordPressBlockedError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      endpoint: error.endpoint,
      body: error.body,
    };
  }
  if (error instanceof WpApiError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      endpoint: error.endpoint,
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

export function rehydratePortalError(error: SerializedPortalError): Error {
  if (error.name === "WordPressBlockedError") {
    return new WordPressBlockedError(
      error.status ?? 0,
      error.body ?? "",
      error.endpoint ?? ""
    );
  }
  if (error.name === "WpConfigError") {
    return new WpConfigError(error.message, error.endpoint ?? "");
  }
  if (error.name === "WpApiError") {
    return new WpApiError(error.message, error.status ?? 0, error.endpoint ?? "");
  }
  const generic = new Error(error.message || "Portal WordPress proxy failed");
  generic.name = error.name || "Error";
  return generic;
}

interface PortalSuccess {
  ok: true;
  result: unknown;
}

interface PortalFailure {
  ok: false;
  error?: SerializedPortalError;
}

export async function callPortalWordPress<T>(body: unknown): Promise<T> {
  const base = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "");
  const secret = process.env.JOB_PROCESSING_SECRET?.trim();
  if (!base || !secret) {
    throw new Error(
      "Video worker cannot call WordPress through the portal (set NEXTAUTH_URL and JOB_PROCESSING_SECRET)."
    );
  }

  const response = await fetch(`${base}${PORTAL_WORDPRESS_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PORTAL_WORDPRESS_TIMEOUT_MS),
  });

  const text = await response.text();
  let payload: PortalSuccess | PortalFailure | null = null;
  try {
    payload = JSON.parse(text) as PortalSuccess | PortalFailure;
  } catch {
    throw new Error(
      `Portal WordPress proxy returned non-JSON (HTTP ${response.status}): ${text.slice(0, 200)}`
    );
  }

  if (payload && payload.ok === true && "result" in payload) {
    return payload.result as T;
  }

  if (payload && payload.ok === false && payload.error) {
    throw rehydratePortalError(payload.error);
  }

  throw new Error(
    `Portal WordPress proxy failed (HTTP ${response.status}): ${text.slice(0, 200)}`
  );
}
