import { db } from "@/lib/db";

/**
 * Safely merge top-level keys into distributionJob.metadata.
 *
 * Several writers (signed-url, thumbnail, analyze, processor, verification)
 * used to do non-transactional read-spread-write on the metadata JSON column,
 * which silently drops keys under concurrency. This helper serializes
 * concurrent writers with a row lock (SELECT ... FOR UPDATE) so merges never
 * lose updates.
 *
 * Setting a key to `undefined` in the patch removes it.
 */
export async function mergeJobMetadata(
  jobId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ metadata: unknown }>>`
      SELECT metadata FROM distribution_jobs WHERE id = ${jobId} FOR UPDATE
    `;
    if (rows.length === 0) return; // job deleted — nothing to merge into

    const metadata = (rows[0].metadata as Record<string, unknown>) ?? {};
    const merged: Record<string, unknown> = { ...metadata, ...patch };
    for (const key of Object.keys(patch)) {
      if (patch[key] === undefined) delete merged[key];
    }

    await tx.distributionJob.update({
      where: { id: jobId },
      // Prisma's JsonValue type is strict — round-trip through JSON to strip
      // undefined/class instances (established pattern in this codebase).
      data: { metadata: JSON.parse(JSON.stringify(merged)) },
    });
  });
}
