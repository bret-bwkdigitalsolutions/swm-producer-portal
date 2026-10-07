/**
 * Point existing Transistor episodes at the WordPress permalink.
 *
 * Sets episode.alternate_url, which Transistor uses as the RSS <link>
 * (the "website" field) instead of share.transistor.fm.
 *
 * Dry run unless --apply is passed. Intended for staging
 * (`railway run` against the staging portal service). Does not merge
 * anything to the production branch.
 *
 *   npx tsx scripts/backfill-transistor-episode-links.ts
 *   npx tsx scripts/backfill-transistor-episode-links.ts --apply
 *
 * Episodes created before networkTransistorEpisodeId was stored have no
 * network-feed id in the portal database. Those copies are skipped.
 */

import pg from "pg";

const BASE_URL = "https://api.transistor.fm/v1";
const APPLY = process.argv.includes("--apply");
// Match src/lib/analytics/credentials.ts — YDC must not use the Sunset Lounge key.
const NO_NETWORK_FALLBACK_SHOW_IDS = new Set([21]);

interface EpisodeTarget {
  jobId: string;
  episodeId: string;
  /** Credential row to use. 0 is the Sunset Lounge network key. */
  credentialWpShowId: number;
  websiteUrl: string;
  label: string;
}

async function apiKeyFor(
  pool: pg.Pool,
  wpShowId: number,
  cache: Map<number, string | null>
): Promise<string | null> {
  if (cache.has(wpShowId)) return cache.get(wpShowId) ?? null;

  const lookup = async (id: number) => {
    const result = await pool.query<{ apiKey: string | null }>(
      `SELECT "apiKey" FROM platform_credentials
       WHERE "wpShowId" = $1 AND platform = 'transistor' AND "apiKey" IS NOT NULL
       LIMIT 1`,
      [id]
    );
    return result.rows[0]?.apiKey ?? null;
  };

  let key = await lookup(wpShowId);
  if (!key && wpShowId !== 0 && !NO_NETWORK_FALLBACK_SHOW_IDS.has(wpShowId)) {
    key = await lookup(0);
  }
  cache.set(wpShowId, key);
  return key;
}

async function currentAlternateUrl(
  apiKey: string,
  episodeId: string
): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/episodes/${episodeId}`, {
    headers: { "x-api-key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`GET episode ${episodeId} failed (${res.status})`);
  }
  const data = (await res.json()) as {
    data?: { attributes?: { alternate_url?: string | null } };
  };
  return data.data?.attributes?.alternate_url ?? null;
}

async function setAlternateUrl(
  apiKey: string,
  episodeId: string,
  websiteUrl: string
): Promise<void> {
  const res = await fetch(`${BASE_URL}/episodes/${episodeId}`, {
    method: "PATCH",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ episode: { alternate_url: websiteUrl } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `PATCH episode ${episodeId} failed (${res.status}): ${body.slice(0, 300)}`
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  const pool = new pg.Pool({ connectionString });
  try {
    const result = await pool.query<{
      job_id: string;
      wp_show_id: number;
      transistor_episode_id: string;
      website_url: string;
      network_episode_id: string | null;
    }>(
      `SELECT
         j.id AS job_id,
         j."wpShowId" AS wp_show_id,
         t."externalId" AS transistor_episode_id,
         w."externalUrl" AS website_url,
         j.metadata->>'networkTransistorEpisodeId' AS network_episode_id
       FROM distribution_job_platforms t
       JOIN distribution_jobs j ON j.id = t."jobId"
       JOIN distribution_job_platforms w
         ON w."jobId" = t."jobId"
        AND w.platform = 'website'
        AND w.status = 'completed'
        AND w."externalUrl" IS NOT NULL
       WHERE t.platform = 'transistor'
         AND t.status = 'completed'
         AND t."externalId" IS NOT NULL
       ORDER BY j."createdAt" ASC`
    );

    const targets: EpisodeTarget[] = [];
    for (const row of result.rows) {
      if (!row.website_url.startsWith("http")) continue;
      targets.push({
        jobId: row.job_id,
        episodeId: row.transistor_episode_id,
        credentialWpShowId: row.wp_show_id,
        websiteUrl: row.website_url,
        label: "show",
      });
      if (row.network_episode_id) {
        targets.push({
          jobId: row.job_id,
          episodeId: row.network_episode_id,
          credentialWpShowId: 0,
          websiteUrl: row.website_url,
          label: "network",
        });
      }
    }

    console.log(
      `${APPLY ? "Applying" : "Dry run"}: ${targets.length} Transistor episode(s) from ${result.rows.length} job(s).`
    );

    const keys = new Map<number, string | null>();
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const target of targets) {
      const apiKey = await apiKeyFor(pool, target.credentialWpShowId, keys);
      if (!apiKey) {
        failed++;
        console.error(
          `  no Transistor key for wpShowId=${target.credentialWpShowId} (job ${target.jobId})`
        );
        continue;
      }

      try {
        const current = await currentAlternateUrl(apiKey, target.episodeId);
        if (current === target.websiteUrl) {
          skipped++;
          console.log(`  skip ${target.label} ${target.episodeId} (already set)`);
          continue;
        }
        console.log(
          `  ${APPLY ? "set" : "would set"} ${target.label} ${target.episodeId} -> ${target.websiteUrl}`
        );
        if (APPLY) {
          await setAlternateUrl(apiKey, target.episodeId, target.websiteUrl);
          updated++;
        }
      } catch (error) {
        failed++;
        console.error(
          `  failed ${target.label} ${target.episodeId}:`,
          error instanceof Error ? error.message : error
        );
      }
      await sleep(300);
    }

    console.log(
      APPLY
        ? `Done. updated=${updated} skipped=${skipped} failed=${failed}`
        : `Dry run complete. skipped=${skipped} failed=${failed}. Re-run with --apply to write.`
    );
    if (failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
