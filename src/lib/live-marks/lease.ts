import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Write a claimed scan. The token must still be the lease owner and the
 * row must still be `processing`. A stale worker's update matches nothing
 * and becomes a no-op.
 */
export async function writeOwnedScan(
  id: string,
  token: string,
  data: Prisma.LiveRecordingUpdateManyMutationInput
): Promise<boolean> {
  if (!token) return false;
  const result = await db.liveRecording.updateMany({
    where: {
      id,
      transcriptClaimToken: token,
      transcriptStatus: "processing",
    },
    data,
  });
  return result.count === 1;
}
