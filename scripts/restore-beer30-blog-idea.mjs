/**
 * One-off script to restore the lost Beer 30 blog idea.
 *
 * Usage: DATABASE_URL="<production-url>" node scripts/restore-beer30-blog-idea.mjs
 *
 * Or via Railway: railway run node scripts/restore-beer30-blog-idea.mjs
 */

import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

// Find the most recent Beer 30 distribution job
const jobResult = await client.query(
  `SELECT id, title, "createdAt" FROM distribution_jobs
   WHERE title ILIKE '%beer 30%'
   ORDER BY "createdAt" DESC LIMIT 5`
);

if (jobResult.rows.length === 0) {
  console.error("No Beer 30 distribution jobs found");
  await client.end();
  process.exit(1);
}

console.log("Recent Beer 30 jobs:");
for (const row of jobResult.rows) {
  console.log(`  ${row.id} — "${row.title}" (${row.createdAt})`);
}

const jobId = jobResult.rows[0].id;
console.log(`\nUsing most recent job: ${jobId}`);

// Check existing blog ideas for this job
const existingResult = await client.query(
  `SELECT id, LEFT(content, 80) as preview, accepted FROM ai_suggestions
   WHERE "jobId" = $1 AND type = 'blog'
   ORDER BY id`,
  [jobId]
);

console.log(`\nExisting blog ideas for this job: ${existingResult.rows.length}`);
for (const row of existingResult.rows) {
  console.log(`  [${row.accepted ? "ACCEPTED" : "available"}] ${row.preview}...`);
}

// The lost blog idea content
const lostIdea = `**"The Complete Guide to American Pale Ales: Understanding Citrus and Pine Hop Profiles"**

This post would dive deep into the science behind hop varieties like Citra, Azaka, Amarillo, and Eldorado that create those citrus and pine flavors the hosts discussed. It would explain how different hop combinations affect taste, aroma, and brewing techniques, plus provide recommendations for beer enthusiasts wanting to understand what they're tasting. This connects to the episode through their detailed beer tasting segment and could drive significant search traffic from craft beer enthusiasts.

Keywords: American pale ale, citrus hops, pine hops, Citra hops, craft beer flavors, hop varieties, beer tasting guide, IPA vs pale ale`;

// Check if this idea already exists
const dupeCheck = await client.query(
  `SELECT id FROM ai_suggestions
   WHERE "jobId" = $1 AND type = 'blog' AND content ILIKE '%American Pale Ales%'`,
  [jobId]
);

if (dupeCheck.rows.length > 0) {
  console.log("\nThis blog idea already exists — skipping insert.");
} else {
  // Generate a cuid-like ID
  const id = `clr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  await client.query(
    `INSERT INTO ai_suggestions (id, "jobId", type, content, accepted)
     VALUES ($1, $2, 'blog', $3, false)`,
    [id, jobId, lostIdea]
  );

  console.log(`\nInserted blog idea with ID: ${id}`);
}

await client.end();
console.log("Done.");
