/**
 * One-off script: re-run the voice synthesizer for one or more shows.
 *
 * Usage (against staging or production):
 *   railway run --service swm-producer-portal -- npx tsx scripts/sync-style-guide.ts 27 21
 *
 * Or local with explicit env:
 *   DATABASE_URL="..." ANTHROPIC_API_KEY="..." npx tsx scripts/sync-style-guide.ts 27 21
 *
 * Args: one or more wpShowId integers. Each runs synthesis in sequence.
 * Known wpShowIds: 27 = The Clubhouse, 21 = Your Dark Companion.
 */

import { synthesizeForShow } from "../src/lib/style-guide/synthesis";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npx tsx scripts/sync-style-guide.ts <wpShowId> [...]");
    process.exit(1);
  }

  const wpShowIds = args.map((a) => {
    const n = parseInt(a, 10);
    if (isNaN(n) || n < 1) {
      console.error(`Invalid wpShowId: ${a}`);
      process.exit(1);
    }
    return n;
  });

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required.");
    process.exit(1);
  }

  for (const wpShowId of wpShowIds) {
    console.log(`\n=== Synthesizing for wpShowId ${wpShowId} ===`);
    const result = await synthesizeForShow(wpShowId);
    if (result.success) {
      console.log(`✓ ${result.message}`);
      if (result.styleGuide) {
        console.log("---");
        console.log(result.styleGuide);
        console.log("---");
      }
    } else {
      console.error(`✗ ${result.message}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    // Cleanly close the prisma client so the process exits
    const { db } = await import("../src/lib/db");
    await db.$disconnect();
  });
