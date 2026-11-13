import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactSecrets } from "./vimeo-events";

const USER_AGENT = "Mozilla/5.0";

function runTool(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pid = child.pid;
    let stdout = "";
    let stderr = "";
    let settled = false;

    const killGroup = () => {
      if (pid == null) {
        child.kill("SIGKILL");
        return;
      }
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // already exited
        }
      }
    };

    const finish = (error?: Error, result?: { code: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ code: result?.code ?? 0, stdout, stderr });
    };

    const timer = setTimeout(() => {
      killGroup();
      finish(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < 20_000) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 8_000) stderr += chunk;
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(undefined, { code: code ?? 1 }));
  });
}

/**
 * Seconds from the start of the stream to the live edge.
 * On this HLS, ffprobe `format.start_time` is that offset.
 */
export async function probeHlsEdgeSeconds(
  url: string,
  referer: string
): Promise<number> {
  const result = await runTool(
    "ffprobe",
    [
      "-hide_banner",
      "-v",
      "error",
      "-user_agent",
      USER_AGENT,
      "-referer",
      referer,
      "-show_entries",
      "format=start_time",
      "-of",
      "json",
      url,
    ],
    25_000
  );
  if (result.code !== 0) {
    throw new Error(
      `ffprobe failed: ${redactSecrets(result.stderr || `code ${result.code}`)}`
    );
  }
  let parsed: { format?: { start_time?: string } };
  try {
    parsed = JSON.parse(result.stdout) as { format?: { start_time?: string } };
  } catch {
    throw new Error("ffprobe did not return JSON.");
  }
  const start = Number(parsed.format?.start_time);
  if (!Number.isFinite(start) || start < 0) return 0;
  return start;
}

/**
 * Pull audio from an HLS URL. `seconds` limits a live-edge capture.
 * Omit it to read the archive (capped by the caller with `-t` via seconds).
 * The playback URL is never included in a thrown error.
 */
export async function captureHlsAudio(input: {
  url: string;
  referer: string;
  seconds?: number;
  seekStart?: boolean;
  timeoutMs: number;
}): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "swm-vimeo-"));
  const output = join(dir, "audio.mp3");
  try {
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      ...(input.seekStart ? ["-ss", "0"] : []),
      "-user_agent",
      USER_AGENT,
      "-referer",
      input.referer,
      "-i",
      input.url,
      ...(input.seconds != null && input.seconds > 0
        ? ["-t", String(Math.ceil(input.seconds))]
        : []),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      output,
    ];
    const result = await runTool("ffmpeg", args, input.timeoutMs);
    if (result.code !== 0) {
      throw new Error(
        `ffmpeg failed: ${redactSecrets(result.stderr || `code ${result.code}`)}`
      );
    }
    const audio = await readFile(output);
    if (audio.byteLength < 1000) {
      throw new Error("ffmpeg wrote no usable audio.");
    }
    return audio;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
