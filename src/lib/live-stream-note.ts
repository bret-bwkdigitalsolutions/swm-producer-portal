/**
 * Copy and metadata helpers for a studio episode that replaces a live-stream
 * WordPress post. Kept free of server-only imports so the distribution UI
 * can use the same sentence as the activity log.
 */

export function liveStreamReplacementNote(postId: number): string {
  return `Replaces live stream post #${postId}`;
}

/** Read `distributionJob.metadata.supersedesLivePostId` (number or numeric string). */
export function readSupersedesLivePostId(value: unknown): number | null {
  const id =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}
