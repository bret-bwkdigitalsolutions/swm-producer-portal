import { config } from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Load .env.local first (Next.js convention), fall back to .env
config({ path: path.join(__dirname, ".env.local") });
config({ path: path.join(__dirname, ".env") });

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrations: {
    path: path.join(__dirname, "prisma", "migrations"),
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    // Use process.env with a placeholder fallback so prisma generate works
    // without a database connection (e.g., during Docker build)
    url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
