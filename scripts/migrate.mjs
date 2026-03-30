/**
 * Lightweight migration runner for production.
 * Reads pending Prisma migration SQL files and applies them directly via pg.
 * No TypeScript runtime, no Prisma CLI, no prisma.config.ts needed.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[migrate] DATABASE_URL is not set. Skipping migrations.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log("[migrate] Connected to database.");

    // Ensure _prisma_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" VARCHAR(36) NOT NULL PRIMARY KEY,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Get already applied migrations
    const { rows: applied } = await client.query(
      `SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`
    );
    const appliedSet = new Set(applied.map((r) => r.migration_name));

    // Read migration directories (sorted alphabetically = chronologically)
    const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
    const migrationDirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => e.name)
      .sort();

    let appliedCount = 0;

    for (const dir of migrationDirs) {
      if (appliedSet.has(dir)) continue;

      const sqlPath = join(MIGRATIONS_DIR, dir, "migration.sql");
      let sql;
      try {
        sql = await readFile(sqlPath, "utf-8");
      } catch {
        console.warn(`[migrate] No migration.sql in ${dir}, skipping.`);
        continue;
      }

      console.log(`[migrate] Applying: ${dir}`);

      const id = crypto.randomUUID();
      await client.query(
        `INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "applied_steps_count")
         VALUES ($1, $2, $3, now(), 0)`,
        [id, "manual", dir]
      );

      try {
        await client.query(sql);
        await client.query(
          `UPDATE "_prisma_migrations" SET "finished_at" = now(), "applied_steps_count" = 1 WHERE "id" = $1`,
          [id]
        );
        console.log(`[migrate] Applied: ${dir}`);
        appliedCount++;
      } catch (err) {
        console.error(`[migrate] FAILED: ${dir}`, err.message);
        await client.query(
          `UPDATE "_prisma_migrations" SET "logs" = $1 WHERE "id" = $2`,
          [err.message, id]
        );
        process.exit(1);
      }
    }

    if (appliedCount === 0) {
      console.log("[migrate] No pending migrations.");
    } else {
      console.log(`[migrate] Applied ${appliedCount} migration(s).`);
    }
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error("[migrate] Fatal error:", err);
  process.exit(1);
});
