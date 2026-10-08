import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_UPLOAD_CHUNK_BYTES,
  UPLOAD_CHUNK_ALIGNMENT_BYTES,
  nextOffsetFromRange,
  streamFilePut,
  uploadFileInChunks,
  uploadFromRemote,
} from "@/lib/platforms/bounded-upload";

function logRss(label: string, fileSize: number, baseline: number, after: number, ceiling: number): number {
  const growth = after - baseline;
  console.info(
    `[rss] ${label} file=${fileSize} baseline=${baseline} after=${after} growth=${growth} ceiling=${ceiling}`
  );
  return growth;
}

const servers: http.Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          // Drop sockets left open by a 4xx or a redirect, or server.close waits.
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function listen(server: http.Server): Promise<number> {
  servers.push(server);
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.timeout = 0;
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test server did not bind a TCP port.");
      }
      resolve(address.port);
    });
  });
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

function memoryTestBytes(): number {
  const raw = process.env.UPLOAD_MEMORY_TEST_BYTES;
  if (!raw) return 1024 * 1024 * 1024;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 32 * 1024 * 1024) {
    throw new Error("UPLOAD_MEMORY_TEST_BYTES must be at least 32 MiB.");
  }
  return Math.floor(value);
}

describe("resumable upload framing", () => {
  it("uses an 8 MiB default chunk that is a multiple of 256 KiB", () => {
    expect(DEFAULT_UPLOAD_CHUNK_BYTES).toBe(8 * 1024 * 1024);
    expect(DEFAULT_UPLOAD_CHUNK_BYTES % UPLOAD_CHUNK_ALIGNMENT_BYTES).toBe(0);
    expect(DEFAULT_UPLOAD_CHUNK_BYTES).toBeGreaterThanOrEqual(8 * 1024 * 1024);
    expect(DEFAULT_UPLOAD_CHUNK_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
  });

  it("reads the committed offset from a 308 Range header", () => {
    expect(nextOffsetFromRange(undefined, 1000)).toBe(0);
    expect(nextOffsetFromRange("bytes=0-99", 1000)).toBe(100);
    expect(nextOffsetFromRange("bytes=0-999", 1000)).toBe(1000);
    expect(nextOffsetFromRange("not-a-range", 1000)).toBe(0);
  });

  it("rejects a chunk size that is not a multiple of 256 KiB", async () => {
    await expect(
      uploadFileInChunks({
        uploadUrl: "http://127.0.0.1:9/upload",
        filePath: "/dev/null",
        contentType: "video/mp4",
        chunkSizeBytes: 1024,
      })
    ).rejects.toThrow(/256 KiB/);
  });
});

describe("uploadFileInChunks", () => {
  it(
    "keeps RSS growth well below the file size",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "swm-upload-mem-"));
      dirs.push(dir);
      const filePath = join(dir, "video.mp4");
      const fileSize = memoryTestBytes();
      const handle = await open(filePath, "w");
      await handle.truncate(fileSize);
      await handle.close();

      const hash = createHash("sha256");
      let received = 0;
      const server = http.createServer((req, res) => {
        const header = req.headers["content-range"];
        const range = Array.isArray(header) ? header[0] : header;
        const query = range ? /bytes \*\/(\d+)/i.exec(range) : null;
        if (query) {
          const total = Number(query[1]);
          if (received >= total && total > 0) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id: "vid-memory" }));
            return;
          }
          res.writeHead(308, received > 0 ? { Range: `bytes=0-${received - 1}` } : undefined);
          res.end();
          return;
        }
        const chunk = range ? /bytes (\d+)-(\d+)\/(\d+)/i.exec(range) : null;
        if (!chunk) {
          res.writeHead(400);
          res.end("missing content-range");
          return;
        }
        const start = Number(chunk[1]);
        const end = Number(chunk[2]);
        const total = Number(chunk[3]);
        if (start !== received) {
          res.writeHead(308, received > 0 ? { Range: `bytes=0-${received - 1}` } : undefined);
          res.end();
          req.resume();
          return;
        }
        req.on("data", (part: Buffer) => {
          received += part.length;
          hash.update(part);
        });
        req.on("end", () => {
          if (received !== end + 1) {
            res.writeHead(400);
            res.end(`short chunk: got ${received}, expected ${end + 1}`);
            return;
          }
          if (received >= total) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id: "vid-memory" }));
            return;
          }
          res.writeHead(308, { Range: `bytes=0-${received - 1}` });
          res.end();
        });
      });

      const port = await listen(server);
      if (global.gc) global.gc();
      const baseline = process.memoryUsage().rss;

      const result = await uploadFileInChunks({
        uploadUrl: `http://127.0.0.1:${port}/upload?uploadType=resumable`,
        filePath,
        contentType: "video/mp4",
        backoffMs: () => 0,
      });

      if (global.gc) global.gc();
      const after = process.memoryUsage().rss;
      const ceiling = Math.min(150 * 1024 * 1024, Math.floor(fileSize / 2));
      const growth = logRss("chunked", fileSize, baseline, after, ceiling);

      expect(result.statusCode).toBe(200);
      expect(result.body).toContain("vid-memory");
      expect(received).toBe(fileSize);
      const fileHash = await hashFile(filePath);
      expect(hash.digest("hex")).toBe(fileHash);
      expect(growth).toBeLessThan(ceiling);

      // Transistor's media PUT is one streamed request, not YouTube's chunks.
      const putHash = createHash("sha256");
      let putReceived = 0;
      const putServer = http.createServer((req, res) => {
        req.on("data", (part: Buffer) => {
          putReceived += part.length;
          putHash.update(part);
        });
        req.on("end", () => {
          res.writeHead(200);
          res.end("ok");
        });
      });
      const putPort = await listen(putServer);
      if (global.gc) global.gc();
      const putBaseline = process.memoryUsage().rss;
      const putResult = await streamFilePut({
        url: `http://127.0.0.1:${putPort}/audio`,
        filePath,
        contentType: "audio/mpeg",
        backoffMs: () => 0,
      });
      if (global.gc) global.gc();
      const putAfter = process.memoryUsage().rss;
      const putGrowth = logRss("stream-put", fileSize, putBaseline, putAfter, ceiling);
      expect(putResult.statusCode).toBe(200);
      expect(putReceived).toBe(fileSize);
      expect(putHash.digest("hex")).toBe(fileHash);
      expect(putGrowth).toBeLessThan(ceiling);
    },
    180_000
  );

  it("queries status and resumes after a 5xx and a dropped connection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "swm-upload-resume-"));
    dirs.push(dir);
    const filePath = join(dir, "video.mp4");
    const chunkSize = UPLOAD_CHUNK_ALIGNMENT_BYTES;
    const fileSize = chunkSize * 4;
    const bytes = Buffer.alloc(fileSize);
    for (let i = 0; i < fileSize; i++) bytes[i] = i % 251;
    await writeFile(filePath, bytes);

    const stored = await open(join(dir, "received.bin"), "w+");
    await stored.truncate(fileSize);
    let committed = 0;
    let failed500 = false;
    let dropped = false;
    const events: string[] = [];

    const server = http.createServer((req, res) => {
      const header = req.headers["content-range"];
      const range = Array.isArray(header) ? header[0] : header ?? "";
      if (/bytes \*\//i.test(range)) {
        events.push("query");
        if (committed === 0) {
          res.writeHead(308);
          res.end();
          return;
        }
        if (committed >= fileSize) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "vid-resume" }));
          return;
        }
        res.writeHead(308, { Range: `bytes=0-${committed - 1}` });
        res.end();
        return;
      }

      const match = /bytes (\d+)-(\d+)\/(\d+)/i.exec(range);
      if (!match) {
        res.writeHead(400);
        res.end("bad range");
        return;
      }
      const start = Number(match[1]);
      const end = Number(match[2]);
      const parts: Buffer[] = [];
      req.on("data", (part: Buffer) => parts.push(part));
      req.on("end", () => {
        void (async () => {
          const body = Buffer.concat(parts);
          if (!failed500 && start === chunkSize) {
            failed500 = true;
            await stored.write(body, 0, body.length, start);
            committed = end + 1;
            events.push(`chunk:${start}:500`);
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("unavailable");
            return;
          }
          if (!dropped && start === chunkSize * 2) {
            dropped = true;
            events.push(`chunk:${start}:drop`);
            req.socket.destroy();
            return;
          }
          if (start > committed) {
            events.push(`chunk:${start}:gap`);
            res.writeHead(308, committed > 0 ? { Range: `bytes=0-${committed - 1}` } : undefined);
            res.end();
            return;
          }
          await stored.write(body, 0, body.length, start);
          committed = Math.max(committed, end + 1);
          events.push(`chunk:${start}`);
          if (committed >= fileSize) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id: "vid-resume" }));
            return;
          }
          res.writeHead(308, { Range: `bytes=0-${committed - 1}` });
          res.end();
        })().catch((error) => {
          res.destroy(error instanceof Error ? error : undefined);
        });
      });
    });

    const port = await listen(server);
    const result = await uploadFileInChunks({
      uploadUrl: `http://127.0.0.1:${port}/upload?upload_id=abc`,
      filePath,
      contentType: "video/mp4",
      chunkSizeBytes: chunkSize,
      maxAttempts: 6,
      backoffMs: () => 0,
    });

    expect(result.body).toContain("vid-resume");
    expect(events).toEqual([
      "chunk:0",
      `chunk:${chunkSize}:500`,
      "query",
      `chunk:${chunkSize * 2}:drop`,
      "query",
      `chunk:${chunkSize * 2}`,
      `chunk:${chunkSize * 3}`,
    ]);
    const received = Buffer.alloc(fileSize);
    await stored.read(received, 0, fileSize, 0);
    expect(Buffer.compare(received, bytes)).toBe(0);
    await stored.close();
  });

  it("does not retry a 4xx", async () => {
    let puts = 0;
    const server = http.createServer((req, res) => {
      puts += 1;
      res.writeHead(401);
      res.end("nope");
      req.resume();
    });
    const dir = await mkdtemp(join(tmpdir(), "swm-upload-4xx-"));
    dirs.push(dir);
    const filePath = join(dir, "clip.mp4");
    await writeFile(filePath, Buffer.alloc(UPLOAD_CHUNK_ALIGNMENT_BYTES, 7));
    const port = await listen(server);

    await expect(
      uploadFileInChunks({
        uploadUrl: `http://127.0.0.1:${port}/upload`,
        filePath,
        contentType: "video/mp4",
        chunkSizeBytes: UPLOAD_CHUNK_ALIGNMENT_BYTES,
        maxAttempts: 4,
        backoffMs: () => 0,
      })
    ).rejects.toThrow(/401/);
    expect(puts).toBe(1);
  });
});

describe("streamFilePut and uploadFromRemote", () => {
  it("retries a single-shot PUT after a 5xx and follows a 307", async () => {
    const dir = await mkdtemp(join(tmpdir(), "swm-put-"));
    dirs.push(dir);
    const filePath = join(dir, "episode.mp3");
    const payload = Buffer.alloc(512 * 1024, 0);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 3) % 256;
    await writeFile(filePath, payload);

    let failures = 1;
    let redirected = false;
    let received: Buffer | null = null;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "PUT" && url.pathname === "/first" && !redirected) {
        redirected = true;
        res.writeHead(307, { Location: "/second" });
        res.end();
        req.resume();
        return;
      }
      const parts: Buffer[] = [];
      req.on("data", (part: Buffer) => parts.push(part));
      req.on("end", () => {
        const body = Buffer.concat(parts);
        if (failures > 0) {
          failures -= 1;
          res.writeHead(503);
          res.end("try again");
          return;
        }
        received = body;
        res.writeHead(200);
        res.end("ok");
      });
    });
    const port = await listen(server);

    const result = await streamFilePut({
      url: `http://127.0.0.1:${port}/first`,
      filePath,
      contentType: "audio/mpeg",
      maxAttempts: 4,
      backoffMs: () => 0,
    });

    expect(result.statusCode).toBe(200);
    expect(redirected).toBe(true);
    expect(received).not.toBeNull();
    expect(Buffer.compare(received!, payload)).toBe(0);
  });

  it("pipes a remote object through node:http and retries the PUT", async () => {
    const payload = Buffer.from("episode-audio-bytes-0123456789");
    let putAttempts = 0;
    let received: Buffer | null = null;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(payload.length),
        });
        res.end(payload);
        return;
      }
      const parts: Buffer[] = [];
      req.on("data", (part: Buffer) => parts.push(part));
      req.on("end", () => {
        putAttempts += 1;
        if (putAttempts === 1) {
          res.writeHead(502);
          res.end("bad gateway");
          return;
        }
        received = Buffer.concat(parts);
        res.writeHead(204);
        res.end();
      });
    });
    const port = await listen(server);
    const result = await uploadFromRemote({
      sourceUrl: `http://127.0.0.1:${port}/audio.mp3`,
      destinationUrl: `http://127.0.0.1:${port}/upload`,
      contentType: "audio/mpeg",
      maxAttempts: 3,
      backoffMs: () => 0,
    });
    expect(result.statusCode).toBe(204);
    expect(putAttempts).toBe(2);
    expect(received).not.toBeNull();
    expect(Buffer.compare(received!, payload)).toBe(0);
  });
});
