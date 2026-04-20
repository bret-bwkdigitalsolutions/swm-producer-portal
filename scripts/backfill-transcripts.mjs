/**
 * Backfill episode_transcript meta on WordPress for all episodes
 * that have transcripts stored in portal job metadata.
 * Formats transcripts with speaker labels from diarization data.
 *
 * Usage: railway run node scripts/backfill-transcripts.mjs [DATABASE_URL]
 */

const WP_API_URL = process.env.WP_API_URL;
const WP_AUTH =
  "Basic " +
  Buffer.from(
    `${process.env.WP_APP_USER}:${process.env.WP_APP_PASSWORD}`
  ).toString("base64");

const DB_URL = process.argv[2] || process.env.DATABASE_URL;

if (!WP_API_URL || !DB_URL) {
  console.error("Missing WP_API_URL or DATABASE_URL");
  console.error("Usage: railway run node scripts/backfill-transcripts.mjs [DATABASE_URL]");
  process.exit(1);
}

/**
 * Parse the timestamped transcript format back into speaker-labeled display text.
 * Input:  "[00:00:00] [Speaker 0] Hello world.\n[00:00:05] [Speaker 1] Hi there."
 * Output: "Speaker 1: Hello world.\n\nSpeaker 2: Hi there."
 */
function formatTimestampedToDisplay(timestamped) {
  const lines = timestamped.split("\n").filter(Boolean);
  const turns = [];
  let currentSpeaker = null;
  let currentText = "";

  for (const line of lines) {
    const match = line.match(/^\[[\d:]+\]\s*(?:\[Speaker (\d+)\])?\s*(.+)$/);
    if (!match) continue;

    const speaker = match[1] !== undefined ? parseInt(match[1], 10) : null;
    const text = match[2];

    if (speaker !== currentSpeaker && currentText) {
      turns.push({
        speaker: currentSpeaker !== null ? `Speaker ${currentSpeaker + 1}` : "",
        text: currentText.trim(),
      });
      currentText = "";
    }
    currentSpeaker = speaker;
    currentText += (currentText ? " " : "") + text;
  }

  if (currentText) {
    turns.push({
      speaker: currentSpeaker !== null ? `Speaker ${currentSpeaker + 1}` : "",
      text: currentText.trim(),
    });
  }

  return turns
    .map((t) => (t.speaker ? `${t.speaker}: ${t.text}` : t.text))
    .join("\n\n");
}

import pg from "pg";
const { Client } = pg;

const db = new Client({ connectionString: DB_URL });
await db.connect();

const { rows } = await db.query(`
  SELECT
    dj.title,
    djp."externalId" as wp_post_id,
    dj.metadata->>'transcriptTimestamped' as timestamped,
    dj.metadata->>'transcript' as raw_transcript
  FROM distribution_jobs dj
  JOIN distribution_job_platforms djp ON djp."jobId" = dj.id
  WHERE djp.platform = 'website'
    AND djp.status = 'completed'
    AND dj.metadata->>'transcript' IS NOT NULL
  ORDER BY dj."createdAt" DESC
`);

console.log(`Found ${rows.length} episodes with transcripts to backfill.\n`);

let success = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  const { title, wp_post_id, timestamped, raw_transcript } = row;

  if (!wp_post_id) {
    console.log(`SKIP: "${title}" — missing post ID`);
    skipped++;
    continue;
  }

  // Use timestamped data for speaker-labeled formatting, fall back to raw
  const transcript = timestamped
    ? formatTimestampedToDisplay(timestamped)
    : raw_transcript;

  if (!transcript) {
    console.log(`SKIP: "${title}" — no transcript data`);
    skipped++;
    continue;
  }

  try {
    const res = await fetch(`${WP_API_URL}/swm_episode/${wp_post_id}`, {
      method: "PUT",
      headers: {
        Authorization: WP_AUTH,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meta: {
          episode_transcript: transcript,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.log(`FAIL: "${title}" (WP ${wp_post_id}) — ${res.status}: ${body.slice(0, 200)}`);
      failed++;
    } else {
      const speakerCount = new Set(transcript.match(/^Speaker \d+:/gm) || []).size;
      console.log(`OK:   "${title}" (WP ${wp_post_id}) — ${transcript.length} chars, ${speakerCount} speakers`);
      success++;
    }
  } catch (error) {
    console.log(`FAIL: "${title}" (WP ${wp_post_id}) — ${error.message}`);
    failed++;
  }
}

await db.end();

console.log(`\nDone. ${success} updated, ${skipped} skipped, ${failed} failed.`);
