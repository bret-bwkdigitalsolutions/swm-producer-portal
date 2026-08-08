import { describe, it, expect } from "vitest";
import { enqueueJob } from "../job-queue";

/** Run `count` tasks through the queue and return the peak observed concurrency. */
async function runBatch(count: number): Promise<number> {
  let active = 0;
  let peak = 0;
  const done: Promise<void>[] = [];
  for (let i = 0; i < count; i++) {
    let resolve!: () => void;
    done.push(new Promise<void>((r) => (resolve = r)));
    enqueueJob(`t${i}`, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      resolve();
    });
  }
  await Promise.all(done);
  return peak;
}

describe("enqueueJob concurrency cap", () => {
  it("caps concurrency at MAX_CONCURRENT_JOBS (2) across many tasks", async () => {
    process.env.MAX_CONCURRENT_JOBS = "2";
    expect(await runBatch(6)).toBe(2);
  });

  it("fully serializes when MAX_CONCURRENT_JOBS=1", async () => {
    process.env.MAX_CONCURRENT_JOBS = "1";
    expect(await runBatch(4)).toBe(1);
  });

  it("a throwing task doesn't wedge the queue", async () => {
    process.env.MAX_CONCURRENT_JOBS = "1";
    let ran = 0;
    const done: Promise<void>[] = [];
    // First task throws; second must still run.
    enqueueJob("boom", async () => {
      ran++;
      throw new Error("boom");
    });
    let resolve!: () => void;
    done.push(new Promise<void>((r) => (resolve = r)));
    enqueueJob("after", async () => {
      ran++;
      resolve();
    });
    await Promise.all(done);
    expect(ran).toBe(2);
  });
});
