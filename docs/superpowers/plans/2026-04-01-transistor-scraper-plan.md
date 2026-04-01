# Transistor Dashboard Analytics Scraper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate weekly extraction of Transistor dashboard analytics (geo, apps, devices, subscriber estimates, aggregated downloads) and blend the data into the portal's existing analytics pages.

**Architecture:** A standalone Playwright scraper script writes to the portal's PostgreSQL database on a weekly Railway cron schedule. The portal reads from new scraped-data tables alongside its existing live API data. A Railway staging environment (deploying from `main`) validates changes before merging to the `production` branch.

**Tech Stack:** Playwright (browser automation), Prisma 7 (database), Resend (failure notifications), Railway (cron scheduling + staging environment)

---

## Phase 0: Railway Staging Environment

### Task 0: Create `production` branch and Railway staging environment

This task is done manually in the Railway dashboard and git CLI. No code changes.

**Files:** None (infrastructure only)

- [ ] **Step 1: Create `production` branch from `main`**

```bash
git checkout main
git pull origin main
git checkout -b production
git push -u origin production
```

- [ ] **Step 2: In Railway dashboard, switch existing production environment to track `production` branch**

Go to Railway project settings > Environments. The current environment (tracking `main`) should be reconfigured:
1. Rename it to "Production" if not already named
2. Set its deploy trigger to the `production` branch

- [ ] **Step 3: Create a new "Staging" environment in Railway**

1. In Railway dashboard, click "New Environment"
2. Name it "Staging"
3. Set deploy trigger to `main` branch
4. Copy all environment variables from Production to Staging (Railway supports this via the environment duplication or manual copy)

- [ ] **Step 4: Create a staging database**

1. In the Staging environment, add a new PostgreSQL plugin/service
2. Copy the `DATABASE_URL` to the Staging environment variables
3. Take a snapshot of the production database and restore it to the staging database (use `pg_dump` / `pg_restore` or Railway's database cloning feature)

- [ ] **Step 5: Update staging `NEXTAUTH_URL` and any environment-specific URLs**

Ensure `NEXTAUTH_URL` points to the staging Railway URL, not the production URL.

- [ ] **Step 6: Verify staging deploys from `main` and the portal works**

Push a no-op commit to `main` or trigger a manual deploy. Verify the staging portal loads and connects to its database.

- [ ] **Step 7: Commit** (no code changes — this is infrastructure only)

---

## Phase 1: Database Schema

### Task 1: Add Prisma migration for scraped analytics tables

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_transistor_scraped_tables/migration.sql` (via `npx prisma migrate dev`)

- [ ] **Step 1: Add the five new models to `prisma/schema.prisma`**

Append after the `InviteToken` model:

```prisma
model TransistorScrapedOverview {
  id                   String   @id @default(cuid())
  wpShowId             Int
  scrapedAt            DateTime
  estimatedSubscribers Int?
  avgDownloads7d       Float?
  avgDownloads30d      Float?
  avgDownloads60d      Float?
  avgDownloads90d      Float?
  monthlyDownloads     Json?
  yearlyDownloads      Json?

  @@unique([wpShowId, scrapedAt])
  @@map("transistor_scraped_overviews")
}

model TransistorScrapedGeo {
  id         String   @id @default(cuid())
  wpShowId   Int
  scrapedAt  DateTime
  country    String
  region     String?
  downloads  Int
  percentage Float?

  @@unique([wpShowId, scrapedAt, country, region])
  @@index([wpShowId, scrapedAt])
  @@map("transistor_scraped_geo")
}

model TransistorScrapedApps {
  id         String   @id @default(cuid())
  wpShowId   Int
  scrapedAt  DateTime
  appName    String
  downloads  Int
  percentage Float?

  @@unique([wpShowId, scrapedAt, appName])
  @@index([wpShowId, scrapedAt])
  @@map("transistor_scraped_apps")
}

model TransistorScrapedDevices {
  id         String   @id @default(cuid())
  wpShowId   Int
  scrapedAt  DateTime
  deviceType String
  deviceName String?
  downloads  Int
  percentage Float?

  @@unique([wpShowId, scrapedAt, deviceType, deviceName])
  @@index([wpShowId, scrapedAt])
  @@map("transistor_scraped_devices")
}

model TransistorScrapeLog {
  id          String    @id @default(cuid())
  startedAt   DateTime
  completedAt DateTime?
  status      String
  account     String
  showCount   Int?
  errors      Json?

  @@map("transistor_scrape_logs")
}
```

- [ ] **Step 2: Generate the migration**

```bash
npx prisma migrate dev --name add_transistor_scraped_tables
```

Expected: Migration created in `prisma/migrations/`, Prisma Client regenerated.

- [ ] **Step 3: Verify the migration applied locally**

```bash
npx prisma studio
```

Expected: All five new tables visible in Prisma Studio with correct columns.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add Prisma schema for Transistor scraped analytics tables"
```

---

## Phase 2: Scraper Service

### Task 2: Initialize the scraper project

**Files:**
- Create: `scripts/transistor-scraper/package.json`
- Create: `scripts/transistor-scraper/tsconfig.json`

- [ ] **Step 1: Create `scripts/transistor-scraper/package.json`**

```json
{
  "name": "transistor-scraper",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "playwright": "^1.52.0",
    "@prisma/client": "^7.5.0",
    "@prisma/adapter-pg": "^7.5.0",
    "pg": "^8.16.0",
    "resend": "^6.9.4",
    "dotenv": "^17.3.1"
  },
  "devDependencies": {
    "tsx": "^4.21.0",
    "typescript": "^5",
    "vitest": "^4.1.2",
    "@types/pg": "^8.15.4"
  }
}
```

- [ ] **Step 2: Create `scripts/transistor-scraper/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd scripts/transistor-scraper
npm install
npx playwright install chromium
```

Expected: `node_modules` created, Chromium browser downloaded.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add scripts/transistor-scraper/package.json scripts/transistor-scraper/tsconfig.json scripts/transistor-scraper/package-lock.json
git commit -m "feat: initialize transistor-scraper project with dependencies"
```

---

### Task 3: Implement scraper authentication

**Files:**
- Create: `scripts/transistor-scraper/auth.ts`
- Test: `scripts/transistor-scraper/auth.test.ts`

- [ ] **Step 1: Write the test for `getAuthenticatedContext`**

Create `scripts/transistor-scraper/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAccountConfig } from "./auth.js";

describe("getAccountConfig", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns sunset config when env vars are set", () => {
    vi.stubEnv("TRANSISTOR_SUNSET_EMAIL", "test@example.com");
    vi.stubEnv("TRANSISTOR_SUNSET_PASSWORD", "secret");

    const config = getAccountConfig("sunset_lounge");
    expect(config).toEqual({
      name: "sunset_lounge",
      email: "test@example.com",
      password: "secret",
      storageStatePath: "transistor-auth-sunset_lounge.json",
    });
  });

  it("returns ydc config when env vars are set", () => {
    vi.stubEnv("TRANSISTOR_YDC_EMAIL", "ydc@example.com");
    vi.stubEnv("TRANSISTOR_YDC_PASSWORD", "ydcsecret");

    const config = getAccountConfig("ydc");
    expect(config).toEqual({
      name: "ydc",
      email: "ydc@example.com",
      password: "ydcsecret",
      storageStatePath: "transistor-auth-ydc.json",
    });
  });

  it("throws if env vars are missing", () => {
    expect(() => getAccountConfig("sunset_lounge")).toThrow(
      "Missing credentials"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd scripts/transistor-scraper
npx vitest run auth.test.ts
```

Expected: FAIL — `getAccountConfig` not found.

- [ ] **Step 3: Implement `auth.ts`**

Create `scripts/transistor-scraper/auth.ts`:

```typescript
import { chromium, type BrowserContext } from "playwright";
import { existsSync } from "node:fs";

export interface AccountConfig {
  name: string;
  email: string;
  password: string;
  storageStatePath: string;
}

const ENV_MAP: Record<string, { email: string; password: string }> = {
  sunset_lounge: {
    email: "TRANSISTOR_SUNSET_EMAIL",
    password: "TRANSISTOR_SUNSET_PASSWORD",
  },
  ydc: {
    email: "TRANSISTOR_YDC_EMAIL",
    password: "TRANSISTOR_YDC_PASSWORD",
  },
};

export function getAccountConfig(account: string): AccountConfig {
  const envKeys = ENV_MAP[account];
  if (!envKeys) throw new Error(`Unknown account: ${account}`);

  const email = process.env[envKeys.email];
  const password = process.env[envKeys.password];
  if (!email || !password) {
    throw new Error(`Missing credentials for ${account}: set ${envKeys.email} and ${envKeys.password}`);
  }

  return {
    name: account,
    email,
    password,
    storageStatePath: `transistor-auth-${account}.json`,
  };
}

export async function getAuthenticatedContext(
  config: AccountConfig
): Promise<BrowserContext> {
  const browser = await chromium.launch({ headless: true });

  // Try existing session
  if (existsSync(config.storageStatePath)) {
    const context = await browser.newContext({
      storageState: config.storageStatePath,
    });
    const page = await context.newPage();
    await page.goto("https://dashboard.transistor.fm");

    // If we land on the dashboard (not redirected to login), session is valid
    if (!page.url().includes("/login") && !page.url().includes("/sign_in")) {
      console.log(`[auth] Reusing saved session for ${config.name}`);
      await page.close();
      return context;
    }
    await context.close();
  }

  // Fresh login
  console.log(`[auth] Logging in as ${config.email}...`);
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://dashboard.transistor.fm/login");
  await page.fill('input[type="email"], input[name="email"]', config.email);
  await page.fill('input[type="password"], input[name="password"]', config.password);
  await page.click('button[type="submit"], input[type="submit"]');

  // Wait for navigation to dashboard
  await page.waitForURL(/dashboard\.transistor\.fm(?!.*login)/, {
    timeout: 15000,
  });

  // Save session state for reuse
  await context.storageState({ path: config.storageStatePath });
  console.log(`[auth] Logged in and saved session for ${config.name}`);

  await page.close();
  return context;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run auth.test.ts
```

Expected: PASS (unit tests for `getAccountConfig` only — `getAuthenticatedContext` requires a real browser and will be tested in integration).

- [ ] **Step 5: Commit**

```bash
cd ../..
git add scripts/transistor-scraper/auth.ts scripts/transistor-scraper/auth.test.ts
git commit -m "feat: implement Transistor scraper authentication with session reuse"
```

---

### Task 4: Implement response interception collector

**Files:**
- Create: `scripts/transistor-scraper/collector.ts`
- Test: `scripts/transistor-scraper/collector.test.ts`

- [ ] **Step 1: Write the test for response parsing**

Create `scripts/transistor-scraper/collector.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { categorizeResponse } from "./collector.js";

describe("categorizeResponse", () => {
  it("identifies a downloads overview response", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/api/v1/analytics/12345",
      { data: { attributes: { downloads: [{ date: "2026-03", downloads: 100 }] } } }
    );
    expect(result).toEqual({ type: "overview", showId: "12345" });
  });

  it("identifies a countries response", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/api/v1/analytics/12345/countries",
      { data: { attributes: { countries: [] } } }
    );
    expect(result).toEqual({ type: "countries", showId: "12345" });
  });

  it("identifies an applications response", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/api/v1/analytics/12345/applications",
      { data: { attributes: { applications: [] } } }
    );
    expect(result).toEqual({ type: "applications", showId: "12345" });
  });

  it("identifies a devices response", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/api/v1/analytics/12345/devices",
      { data: { attributes: { devices: [] } } }
    );
    expect(result).toEqual({ type: "devices", showId: "12345" });
  });

  it("returns null for unrecognized URLs", () => {
    const result = categorizeResponse(
      "https://dashboard.transistor.fm/api/v1/shows",
      { data: [] }
    );
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd scripts/transistor-scraper
npx vitest run collector.test.ts
```

Expected: FAIL — `categorizeResponse` not found.

- [ ] **Step 3: Implement `collector.ts`**

Create `scripts/transistor-scraper/collector.ts`:

```typescript
import type { BrowserContext, Response } from "playwright";

export interface ResponseCategory {
  type: "overview" | "countries" | "applications" | "devices";
  showId: string;
}

export interface CollectedData {
  overview: Record<string, unknown> | null;
  countries: Record<string, unknown>[] | null;
  applications: Record<string, unknown>[] | null;
  devices: Record<string, unknown>[] | null;
}

const ANALYTICS_PATTERN = /\/analytics\/(\d+)(\/(\w+))?/;

export function categorizeResponse(
  url: string,
  _body: unknown
): ResponseCategory | null {
  const match = url.match(ANALYTICS_PATTERN);
  if (!match) return null;

  const showId = match[1];
  const subpath = match[3];

  if (subpath === "countries") return { type: "countries", showId };
  if (subpath === "applications") return { type: "applications", showId };
  if (subpath === "devices") return { type: "devices", showId };
  if (!subpath) return { type: "overview", showId };

  return null;
}

export async function collectShowAnalytics(
  context: BrowserContext,
  transistorShowId: string
): Promise<CollectedData> {
  const collected: CollectedData = {
    overview: null,
    countries: null,
    applications: null,
    devices: null,
  };

  const page = await context.newPage();

  // Intercept API responses
  page.on("response", async (response: Response) => {
    const url = response.url();
    if (!url.includes("/analytics/")) return;
    if (response.status() !== 200) return;

    try {
      const body = await response.json();
      const category = categorizeResponse(url, body);
      if (!category || category.showId !== transistorShowId) return;

      switch (category.type) {
        case "overview":
          collected.overview = body?.data?.attributes ?? null;
          break;
        case "countries":
          collected.countries = body?.data?.attributes?.countries ?? null;
          break;
        case "applications":
          collected.applications = body?.data?.attributes?.applications ?? null;
          break;
        case "devices":
          collected.devices = body?.data?.attributes?.devices ?? null;
          break;
      }
    } catch {
      // Non-JSON response or parsing error — skip
    }
  });

  // Navigate to the show's analytics pages to trigger the API calls
  const baseUrl = `https://dashboard.transistor.fm/shows/${transistorShowId}/analytics`;

  console.log(`[collector] Navigating to overview: ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  // Navigate to sub-pages to trigger additional API calls
  for (const subpage of ["countries", "applications", "devices"]) {
    const url = `${baseUrl}/${subpage}`;
    console.log(`[collector] Navigating to ${subpage}: ${url}`);
    await page.goto(url, { waitUntil: "networkidle" });
  }

  await page.close();
  return collected;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run collector.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ../..
git add scripts/transistor-scraper/collector.ts scripts/transistor-scraper/collector.test.ts
git commit -m "feat: implement Transistor analytics response interception and collection"
```

---

### Task 5: Implement data parser

**Files:**
- Create: `scripts/transistor-scraper/parser.ts`
- Test: `scripts/transistor-scraper/parser.test.ts`

- [ ] **Step 1: Write the test for parsing collected data**

Create `scripts/transistor-scraper/parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  parseOverview,
  parseGeo,
  parseApps,
  parseDevices,
} from "./parser.js";

const scrapedAt = new Date("2026-04-01T03:00:00Z");

describe("parseOverview", () => {
  it("extracts subscriber and average download stats", () => {
    const raw = {
      estimated_subscribers: 450,
      average_downloads: {
        "7_days": 120.5,
        "30_days": 98.3,
        "60_days": 85.1,
        "90_days": 72.0,
      },
      downloads: [
        { date: "2026-03", downloads: 1200 },
        { date: "2026-02", downloads: 1100 },
      ],
    };

    const result = parseOverview(raw, 22, scrapedAt);
    expect(result).toEqual({
      wpShowId: 22,
      scrapedAt,
      estimatedSubscribers: 450,
      avgDownloads7d: 120.5,
      avgDownloads30d: 98.3,
      avgDownloads60d: 85.1,
      avgDownloads90d: 72.0,
      monthlyDownloads: { "2026-03": 1200, "2026-02": 1100 },
      yearlyDownloads: null,
    });
  });

  it("handles missing fields gracefully", () => {
    const result = parseOverview({}, 22, scrapedAt);
    expect(result.estimatedSubscribers).toBeNull();
    expect(result.avgDownloads7d).toBeNull();
    expect(result.monthlyDownloads).toBeNull();
  });
});

describe("parseGeo", () => {
  it("maps country data to database rows", () => {
    const raw = [
      { country: "United States", downloads: 500, percent: 45.5 },
      { country: "Canada", downloads: 200, percent: 18.2 },
    ];

    const result = parseGeo(raw, 22, scrapedAt);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      wpShowId: 22,
      scrapedAt,
      country: "United States",
      region: null,
      downloads: 500,
      percentage: 45.5,
    });
  });
});

describe("parseApps", () => {
  it("maps application data to database rows", () => {
    const raw = [
      { app: "Apple Podcasts", downloads: 300, percent: 60.0 },
      { app: "Spotify", downloads: 200, percent: 40.0 },
    ];

    const result = parseApps(raw, 22, scrapedAt);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      wpShowId: 22,
      scrapedAt,
      appName: "Apple Podcasts",
      downloads: 300,
      percentage: 60.0,
    });
  });
});

describe("parseDevices", () => {
  it("maps device data to database rows", () => {
    const raw = [
      { device: "iPhone", device_type: "mobile", downloads: 400, percentage: 50.0 },
      { device: "Desktop", device_type: "desktop", downloads: 200, percentage: 25.0 },
    ];

    const result = parseDevices(raw, 22, scrapedAt);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      wpShowId: 22,
      scrapedAt,
      deviceType: "mobile",
      deviceName: "iPhone",
      downloads: 400,
      percentage: 50.0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd scripts/transistor-scraper
npx vitest run parser.test.ts
```

Expected: FAIL — parser functions not found.

- [ ] **Step 3: Implement `parser.ts`**

Create `scripts/transistor-scraper/parser.ts`:

```typescript
export interface ParsedOverview {
  wpShowId: number;
  scrapedAt: Date;
  estimatedSubscribers: number | null;
  avgDownloads7d: number | null;
  avgDownloads30d: number | null;
  avgDownloads60d: number | null;
  avgDownloads90d: number | null;
  monthlyDownloads: Record<string, number> | null;
  yearlyDownloads: Record<string, number> | null;
}

export interface ParsedGeo {
  wpShowId: number;
  scrapedAt: Date;
  country: string;
  region: string | null;
  downloads: number;
  percentage: number | null;
}

export interface ParsedApp {
  wpShowId: number;
  scrapedAt: Date;
  appName: string;
  downloads: number;
  percentage: number | null;
}

export interface ParsedDevice {
  wpShowId: number;
  scrapedAt: Date;
  deviceType: string;
  deviceName: string | null;
  downloads: number;
  percentage: number | null;
}

export function parseOverview(
  raw: Record<string, unknown>,
  wpShowId: number,
  scrapedAt: Date
): ParsedOverview {
  const avgDownloads = (raw.average_downloads ?? {}) as Record<string, number>;
  const downloads = raw.downloads as { date: string; downloads: number }[] | undefined;

  let monthlyDownloads: Record<string, number> | null = null;
  if (downloads && downloads.length > 0) {
    monthlyDownloads = {};
    for (const d of downloads) {
      monthlyDownloads[d.date] = d.downloads;
    }
  }

  return {
    wpShowId,
    scrapedAt,
    estimatedSubscribers: (raw.estimated_subscribers as number) ?? null,
    avgDownloads7d: avgDownloads["7_days"] ?? null,
    avgDownloads30d: avgDownloads["30_days"] ?? null,
    avgDownloads60d: avgDownloads["60_days"] ?? null,
    avgDownloads90d: avgDownloads["90_days"] ?? null,
    monthlyDownloads,
    yearlyDownloads: null, // Will be populated if we find yearly data in the response
  };
}

export function parseGeo(
  raw: Record<string, unknown>[],
  wpShowId: number,
  scrapedAt: Date
): ParsedGeo[] {
  return raw.map((entry) => ({
    wpShowId,
    scrapedAt,
    country: (entry.country as string) ?? "Unknown",
    region: (entry.region as string) ?? null,
    downloads: (entry.downloads as number) ?? 0,
    percentage: (entry.percent as number) ?? (entry.percentage as number) ?? null,
  }));
}

export function parseApps(
  raw: Record<string, unknown>[],
  wpShowId: number,
  scrapedAt: Date
): ParsedApp[] {
  return raw.map((entry) => ({
    wpShowId,
    scrapedAt,
    appName: (entry.app as string) ?? "Unknown",
    downloads: (entry.downloads as number) ?? 0,
    percentage: (entry.percent as number) ?? (entry.percentage as number) ?? null,
  }));
}

export function parseDevices(
  raw: Record<string, unknown>[],
  wpShowId: number,
  scrapedAt: Date
): ParsedDevice[] {
  return raw.map((entry) => ({
    wpShowId,
    scrapedAt,
    deviceType: (entry.device_type as string) ?? "unknown",
    deviceName: (entry.device as string) ?? null,
    downloads: (entry.downloads as number) ?? 0,
    percentage: (entry.percentage as number) ?? (entry.percent as number) ?? null,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run parser.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ../..
git add scripts/transistor-scraper/parser.ts scripts/transistor-scraper/parser.test.ts
git commit -m "feat: implement parsers for Transistor scraped analytics data"
```

---

### Task 6: Implement database storage

**Files:**
- Create: `scripts/transistor-scraper/storage.ts`

- [ ] **Step 1: Implement `storage.ts`**

Create `scripts/transistor-scraper/storage.ts`:

```typescript
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type {
  ParsedOverview,
  ParsedGeo,
  ParsedApp,
  ParsedDevice,
} from "./parser.js";

let prisma: PrismaClient | null = null;

export function getDb(): PrismaClient {
  if (prisma) return prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
  return prisma;
}

export async function upsertOverview(data: ParsedOverview): Promise<void> {
  const db = getDb();
  await db.transistorScrapedOverview.upsert({
    where: {
      wpShowId_scrapedAt: {
        wpShowId: data.wpShowId,
        scrapedAt: data.scrapedAt,
      },
    },
    update: {
      estimatedSubscribers: data.estimatedSubscribers,
      avgDownloads7d: data.avgDownloads7d,
      avgDownloads30d: data.avgDownloads30d,
      avgDownloads60d: data.avgDownloads60d,
      avgDownloads90d: data.avgDownloads90d,
      monthlyDownloads: data.monthlyDownloads,
      yearlyDownloads: data.yearlyDownloads,
    },
    create: data,
  });
}

export async function upsertGeo(rows: ParsedGeo[]): Promise<void> {
  const db = getDb();
  for (const row of rows) {
    await db.transistorScrapedGeo.upsert({
      where: {
        wpShowId_scrapedAt_country_region: {
          wpShowId: row.wpShowId,
          scrapedAt: row.scrapedAt,
          country: row.country,
          region: row.region ?? "",
        },
      },
      update: {
        downloads: row.downloads,
        percentage: row.percentage,
      },
      create: {
        ...row,
        region: row.region ?? "",
      },
    });
  }
}

export async function upsertApps(rows: ParsedApp[]): Promise<void> {
  const db = getDb();
  for (const row of rows) {
    await db.transistorScrapedApps.upsert({
      where: {
        wpShowId_scrapedAt_appName: {
          wpShowId: row.wpShowId,
          scrapedAt: row.scrapedAt,
          appName: row.appName,
        },
      },
      update: {
        downloads: row.downloads,
        percentage: row.percentage,
      },
      create: row,
    });
  }
}

export async function upsertDevices(rows: ParsedDevice[]): Promise<void> {
  const db = getDb();
  for (const row of rows) {
    await db.transistorScrapedDevices.upsert({
      where: {
        wpShowId_scrapedAt_deviceType_deviceName: {
          wpShowId: row.wpShowId,
          scrapedAt: row.scrapedAt,
          deviceType: row.deviceType,
          deviceName: row.deviceName ?? "",
        },
      },
      update: {
        downloads: row.downloads,
        percentage: row.percentage,
      },
      create: {
        ...row,
        deviceName: row.deviceName ?? "",
      },
    });
  }
}

export async function createScrapeLog(
  account: string
): Promise<string> {
  const db = getDb();
  const log = await db.transistorScrapeLog.create({
    data: {
      startedAt: new Date(),
      status: "running",
      account,
    },
  });
  return log.id;
}

export async function completeScrapeLog(
  logId: string,
  showCount: number,
  errors: string[]
): Promise<void> {
  const db = getDb();
  await db.transistorScrapeLog.update({
    where: { id: logId },
    data: {
      completedAt: new Date(),
      status: errors.length > 0 ? "failed" : "completed",
      showCount,
      errors: errors.length > 0 ? errors : undefined,
    },
  });
}

export async function disconnect(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/transistor-scraper/storage.ts
git commit -m "feat: implement Prisma storage layer for scraped Transistor analytics"
```

---

### Task 7: Implement failure notification

**Files:**
- Create: `scripts/transistor-scraper/notify.ts`

- [ ] **Step 1: Implement `notify.ts`**

Create `scripts/transistor-scraper/notify.ts`:

```typescript
export async function sendFailureNotification(
  account: string,
  errors: string[]
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[notify] RESEND_API_KEY is not set — skipping notification.");
    return;
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  const errorList = errors.map((e) => `<li>${e}</li>`).join("\n");

  try {
    await resend.emails.send({
      from: "SWM Producer Portal <info@stolenwatermedia.com>",
      to: ["bret@stolenwatermedia.com"],
      subject: `Transistor scraper failed — ${account}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
          <h2 style="margin: 0 0 16px; font-size: 20px; color: #dc2626;">
            Transistor Scraper Failed
          </h2>
          <p style="color: #111;">Account: <strong>${account}</strong></p>
          <p style="color: #111;">Time: ${new Date().toISOString()}</p>
          <h3 style="margin: 16px 0 8px; font-size: 14px; color: #111;">Errors</h3>
          <ul style="color: #dc2626;">${errorList}</ul>
        </div>
      `,
    });
  } catch (error) {
    console.error("[notify] Failed to send failure notification:", error);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/transistor-scraper/notify.ts
git commit -m "feat: add failure notification for Transistor scraper via Resend"
```

---

### Task 8: Implement main orchestrator

**Files:**
- Create: `scripts/transistor-scraper/index.ts`
- Create: `scripts/transistor-scraper/show-map.ts`

- [ ] **Step 1: Create `show-map.ts` mapping Transistor show IDs to wpShowIds**

Create `scripts/transistor-scraper/show-map.ts`:

```typescript
/**
 * Maps Transistor show slugs/IDs to portal wpShowIds.
 * This must be kept in sync with ShowPlatformLink records in the portal database.
 *
 * On first run, the scraper will auto-discover this mapping by reading
 * ShowPlatformLink records from the database. This file provides the
 * account-to-network mapping so we know which shows to scrape per login.
 */

export interface AccountShowMap {
  account: string;
  wpShowIds: number[];
}

export const ACCOUNT_SHOWS: AccountShowMap[] = [
  {
    account: "sunset_lounge",
    wpShowIds: [22, 23, 24, 25, 26, 27, 28],
  },
  {
    account: "ydc",
    wpShowIds: [21],
  },
];
```

- [ ] **Step 2: Implement `index.ts`**

Create `scripts/transistor-scraper/index.ts`:

```typescript
import "dotenv/config";
import { getAccountConfig, getAuthenticatedContext } from "./auth.js";
import { collectShowAnalytics } from "./collector.js";
import { parseOverview, parseGeo, parseApps, parseDevices } from "./parser.js";
import {
  upsertOverview,
  upsertGeo,
  upsertApps,
  upsertDevices,
  createScrapeLog,
  completeScrapeLog,
  disconnect,
  getDb,
} from "./storage.js";
import { sendFailureNotification } from "./notify.js";
import { ACCOUNT_SHOWS } from "./show-map.js";

async function resolveTransistorShowId(
  wpShowId: number
): Promise<string | null> {
  const db = getDb();
  const link = await db.showPlatformLink.findUnique({
    where: { wpShowId_platform: { wpShowId, platform: "transistor_show" } },
  });
  if (!link) return null;

  // Extract show ID from URL (e.g., "https://transistor.fm/shows/12345" -> "12345")
  // or it might just be a numeric ID stored directly
  const match = link.url.match(/(\d+)/);
  return match ? match[1] : null;
}

async function scrapeAccount(accountName: string, wpShowIds: number[]): Promise<void> {
  const config = getAccountConfig(accountName);
  const logId = await createScrapeLog(accountName);
  const errors: string[] = [];
  let showCount = 0;

  let context;
  try {
    context = await getAuthenticatedContext(config);
  } catch (err) {
    const message = `Login failed for ${accountName}: ${(err as Error).message}`;
    console.error(`[scraper] ${message}`);
    errors.push(message);
    await completeScrapeLog(logId, 0, errors);
    await sendFailureNotification(accountName, errors);
    return;
  }

  const scrapedAt = new Date();

  for (const wpShowId of wpShowIds) {
    try {
      const transistorShowId = await resolveTransistorShowId(wpShowId);
      if (!transistorShowId) {
        console.warn(`[scraper] No Transistor show ID found for wpShowId=${wpShowId}, skipping.`);
        continue;
      }

      console.log(`[scraper] Collecting analytics for wpShowId=${wpShowId} (transistor=${transistorShowId})`);
      const data = await collectShowAnalytics(context, transistorShowId);

      // Parse and store overview
      if (data.overview) {
        const overview = parseOverview(data.overview as Record<string, unknown>, wpShowId, scrapedAt);
        await upsertOverview(overview);
      }

      // Parse and store geo
      if (data.countries) {
        const geo = parseGeo(data.countries as Record<string, unknown>[], wpShowId, scrapedAt);
        await upsertGeo(geo);
      }

      // Parse and store apps
      if (data.applications) {
        const apps = parseApps(data.applications as Record<string, unknown>[], wpShowId, scrapedAt);
        await upsertApps(apps);
      }

      // Parse and store devices
      if (data.devices) {
        const devices = parseDevices(data.devices as Record<string, unknown>[], wpShowId, scrapedAt);
        await upsertDevices(devices);
      }

      showCount++;
      console.log(`[scraper] Completed wpShowId=${wpShowId}`);
    } catch (err) {
      const message = `Failed for wpShowId=${wpShowId}: ${(err as Error).message}`;
      console.error(`[scraper] ${message}`);
      errors.push(message);
      // Continue with other shows
    }
  }

  await context.browser()?.close();
  await completeScrapeLog(logId, showCount, errors);

  if (errors.length > 0) {
    await sendFailureNotification(accountName, errors);
  }

  console.log(`[scraper] ${accountName}: ${showCount} shows scraped, ${errors.length} errors`);
}

async function main(): Promise<void> {
  console.log(`[scraper] Starting Transistor analytics scrape at ${new Date().toISOString()}`);

  for (const { account, wpShowIds } of ACCOUNT_SHOWS) {
    await scrapeAccount(account, wpShowIds);
  }

  await disconnect();
  console.log(`[scraper] Done.`);
}

main().catch((err) => {
  console.error("[scraper] Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Commit**

```bash
git add scripts/transistor-scraper/index.ts scripts/transistor-scraper/show-map.ts
git commit -m "feat: implement main scraper orchestrator with per-account processing"
```

---

### Task 9: Add scraper Dockerfile

**Files:**
- Create: `scripts/transistor-scraper/Dockerfile`

- [ ] **Step 1: Create `scripts/transistor-scraper/Dockerfile`**

```dockerfile
FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

# Copy Prisma schema from the portal root for client generation
COPY ../../prisma ./prisma/
COPY ../../prisma.config.ts ./

# Generate Prisma Client
RUN npx prisma generate

COPY *.ts ./

CMD ["npx", "tsx", "index.ts"]
```

Note: The exact Dockerfile structure may need adjustment during deployment depending on Railway's build context. The Prisma schema must be accessible for client generation. An alternative is to build from the repo root with a different Dockerfile path.

- [ ] **Step 2: Create a `.dockerignore` for the scraper**

Create `scripts/transistor-scraper/.dockerignore`:

```
node_modules
dist
*.test.ts
transistor-auth-*.json
```

- [ ] **Step 3: Commit**

```bash
git add scripts/transistor-scraper/Dockerfile scripts/transistor-scraper/.dockerignore
git commit -m "feat: add Dockerfile for Transistor scraper service"
```

---

### Task 10: Add manual trigger API endpoint

**Files:**
- Create: `src/app/api/scraper/trigger/route.ts`

- [ ] **Step 1: Implement the trigger endpoint**

Create `src/app/api/scraper/trigger/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST(request: Request) {
  // Verify admin access
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // This endpoint can be used to trigger a scraper run via Railway's API
  // or by calling the scraper service directly. For now, it returns
  // the scrape log status so admins can monitor health.

  // In production, this would trigger the Railway cron job via their API:
  // POST https://backboard.railway.app/graphql with a triggerCronJob mutation
  // For now, return a placeholder that can be wired up during deployment.

  return NextResponse.json({
    message: "Scraper trigger endpoint ready. Wire up Railway cron trigger during deployment.",
    timestamp: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/scraper/trigger/route.ts
git commit -m "feat: add admin-only scraper trigger API endpoint"
```

---

## Phase 3: Portal Integration

### Task 11: Add server actions for scraped data

**Files:**
- Modify: `src/app/dashboard/analytics/actions.ts`

- [ ] **Step 1: Add scraped data fetch functions to `actions.ts`**

Add these imports and functions after the existing Transistor actions section (after line 82 in `src/app/dashboard/analytics/actions.ts`):

```typescript
// --- Scraped Transistor analytics actions ---

export interface ScrapedOverviewData {
  estimatedSubscribers: number | null;
  avgDownloads7d: number | null;
  avgDownloads30d: number | null;
  avgDownloads60d: number | null;
  avgDownloads90d: number | null;
  monthlyDownloads: Record<string, number> | null;
  yearlyDownloads: Record<string, number> | null;
  scrapedAt: Date | null;
}

export interface ScrapedGeoEntry {
  country: string;
  region: string | null;
  downloads: number;
  percentage: number | null;
}

export interface ScrapedAppEntry {
  appName: string;
  downloads: number;
  percentage: number | null;
}

export interface ScrapedDeviceEntry {
  deviceType: string;
  deviceName: string | null;
  downloads: number;
  percentage: number | null;
}

export async function fetchScrapedOverview(
  wpShowId: number
): Promise<ScrapedOverviewData> {
  await requireShowAccess(wpShowId);

  const latest = await db.transistorScrapedOverview.findFirst({
    where: { wpShowId },
    orderBy: { scrapedAt: "desc" },
  });

  if (!latest) {
    return {
      estimatedSubscribers: null,
      avgDownloads7d: null,
      avgDownloads30d: null,
      avgDownloads60d: null,
      avgDownloads90d: null,
      monthlyDownloads: null,
      yearlyDownloads: null,
      scrapedAt: null,
    };
  }

  return {
    estimatedSubscribers: latest.estimatedSubscribers,
    avgDownloads7d: latest.avgDownloads7d,
    avgDownloads30d: latest.avgDownloads30d,
    avgDownloads60d: latest.avgDownloads60d,
    avgDownloads90d: latest.avgDownloads90d,
    monthlyDownloads: latest.monthlyDownloads as Record<string, number> | null,
    yearlyDownloads: latest.yearlyDownloads as Record<string, number> | null,
    scrapedAt: latest.scrapedAt,
  };
}

export async function fetchScrapedGeo(
  wpShowId: number
): Promise<{ data: ScrapedGeoEntry[]; scrapedAt: Date | null }> {
  await requireShowAccess(wpShowId);

  const latest = await db.transistorScrapedGeo.findFirst({
    where: { wpShowId },
    orderBy: { scrapedAt: "desc" },
    select: { scrapedAt: true },
  });

  if (!latest) return { data: [], scrapedAt: null };

  const rows = await db.transistorScrapedGeo.findMany({
    where: { wpShowId, scrapedAt: latest.scrapedAt },
    orderBy: { downloads: "desc" },
  });

  return {
    data: rows.map((r) => ({
      country: r.country,
      region: r.region,
      downloads: r.downloads,
      percentage: r.percentage,
    })),
    scrapedAt: latest.scrapedAt,
  };
}

export async function fetchScrapedApps(
  wpShowId: number
): Promise<{ data: ScrapedAppEntry[]; scrapedAt: Date | null }> {
  await requireShowAccess(wpShowId);

  const latest = await db.transistorScrapedApps.findFirst({
    where: { wpShowId },
    orderBy: { scrapedAt: "desc" },
    select: { scrapedAt: true },
  });

  if (!latest) return { data: [], scrapedAt: null };

  const rows = await db.transistorScrapedApps.findMany({
    where: { wpShowId, scrapedAt: latest.scrapedAt },
    orderBy: { downloads: "desc" },
  });

  return {
    data: rows.map((r) => ({
      appName: r.appName,
      downloads: r.downloads,
      percentage: r.percentage,
    })),
    scrapedAt: latest.scrapedAt,
  };
}

export async function fetchScrapedDevices(
  wpShowId: number
): Promise<{ data: ScrapedDeviceEntry[]; scrapedAt: Date | null }> {
  await requireShowAccess(wpShowId);

  const latest = await db.transistorScrapedDevices.findFirst({
    where: { wpShowId },
    orderBy: { scrapedAt: "desc" },
    select: { scrapedAt: true },
  });

  if (!latest) return { data: [], scrapedAt: null };

  const rows = await db.transistorScrapedDevices.findMany({
    where: { wpShowId, scrapedAt: latest.scrapedAt },
    orderBy: { downloads: "desc" },
  });

  return {
    data: rows.map((r) => ({
      deviceType: r.deviceType,
      deviceName: r.deviceName,
      downloads: r.downloads,
      percentage: r.percentage,
    })),
    scrapedAt: latest.scrapedAt,
  };
}

export async function fetchScraperHealth(): Promise<{
  lastRun: Date | null;
  status: string | null;
  errors: unknown;
}> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { lastRun: null, status: null, errors: null };
  }

  const latest = await db.transistorScrapeLog.findFirst({
    orderBy: { startedAt: "desc" },
  });

  if (!latest) return { lastRun: null, status: null, errors: null };

  return {
    lastRun: latest.startedAt,
    status: latest.status,
    errors: latest.errors,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/analytics/actions.ts
git commit -m "feat: add server actions for fetching scraped Transistor analytics"
```

---

### Task 12: Add "Updated" badge component

**Files:**
- Create: `src/components/analytics/scraped-data-badge.tsx`

- [ ] **Step 1: Create the badge component**

Create `src/components/analytics/scraped-data-badge.tsx`:

```tsx
import { formatDistanceToNow } from "date-fns";

interface ScrapedDataBadgeProps {
  scrapedAt: Date | null;
  warnAfterDays?: number;
}

export default function ScrapedDataBadge({
  scrapedAt,
  warnAfterDays = 10,
}: ScrapedDataBadgeProps) {
  if (!scrapedAt) {
    return (
      <span className="text-xs text-muted-foreground">No data yet</span>
    );
  }

  const daysSince = Math.floor(
    (Date.now() - new Date(scrapedAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  const isStale = daysSince > warnAfterDays;

  return (
    <span
      className={`text-xs ${isStale ? "text-amber-500 font-medium" : "text-muted-foreground"}`}
    >
      Updated {formatDistanceToNow(new Date(scrapedAt), { addSuffix: true })}
      {isStale && " (stale)"}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/scraped-data-badge.tsx
git commit -m "feat: add ScrapedDataBadge component for data freshness indicators"
```

---

### Task 13: Add Listeners section to podcast analytics page

**Files:**
- Create: `src/components/analytics/listeners-section.tsx`
- Modify: `src/app/dashboard/analytics/podcasts/page.tsx`

- [ ] **Step 1: Create the listeners section component**

Create `src/components/analytics/listeners-section.tsx`:

```tsx
"use client";

import { useState } from "react";
import BarChart from "@/components/analytics/charts/bar-chart";
import DonutChart from "@/components/analytics/charts/donut-chart";
import ScrapedDataBadge from "@/components/analytics/scraped-data-badge";
import type {
  ScrapedGeoEntry,
  ScrapedAppEntry,
  ScrapedDeviceEntry,
} from "@/app/dashboard/analytics/actions";

type Tab = "geography" | "apps" | "devices";

interface ListenersSectionProps {
  geo: { data: ScrapedGeoEntry[]; scrapedAt: Date | null };
  apps: { data: ScrapedAppEntry[]; scrapedAt: Date | null };
  devices: { data: ScrapedDeviceEntry[]; scrapedAt: Date | null };
  loading?: boolean;
}

export default function ListenersSection({
  geo,
  apps,
  devices,
  loading,
}: ListenersSectionProps) {
  const [activeTab, setActiveTab] = useState<Tab>("geography");

  const tabs: { key: Tab; label: string }[] = [
    { key: "geography", label: "Geography" },
    { key: "apps", label: "Apps" },
    { key: "devices", label: "Devices" },
  ];

  const hasAnyData =
    geo.data.length > 0 || apps.data.length > 0 || devices.data.length > 0;

  if (!hasAnyData && !loading) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Listeners</h2>
        <ScrapedDataBadge
          scrapedAt={
            activeTab === "geography"
              ? geo.scrapedAt
              : activeTab === "apps"
                ? apps.scrapedAt
                : devices.scrapedAt
          }
        />
      </div>

      {/* Tab bar */}
      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-[300px] animate-pulse rounded bg-muted" />
      ) : (
        <>
          {activeTab === "geography" && (
            <GeoView data={geo.data} />
          )}
          {activeTab === "apps" && (
            <AppsView data={apps.data} />
          )}
          {activeTab === "devices" && (
            <DevicesView data={devices.data} />
          )}
        </>
      )}
    </div>
  );
}

function GeoView({ data }: { data: ScrapedGeoEntry[] }) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No geographic data available.</p>;
  }

  const top10 = data.slice(0, 10);
  const chartData = top10.map((d) => ({
    name: d.country,
    downloads: d.downloads,
  }));

  return (
    <div className="space-y-4">
      <BarChart
        data={chartData as unknown as Record<string, unknown>[]}
        xKey="name"
        series={[{ dataKey: "downloads", name: "Downloads", color: "#6366f1" }]}
        layout="horizontal"
        height={Math.max(200, top10.length * 36)}
      />
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 font-medium">Country</th>
              <th className="pb-2 text-right font-medium">Downloads</th>
              <th className="pb-2 text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1.5">{row.country}{row.region ? `, ${row.region}` : ""}</td>
                <td className="py-1.5 text-right">{row.downloads.toLocaleString()}</td>
                <td className="py-1.5 text-right text-muted-foreground">
                  {row.percentage != null ? `${row.percentage.toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AppsView({ data }: { data: ScrapedAppEntry[] }) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No app data available.</p>;
  }

  const donutData = data.slice(0, 8).map((d) => ({
    name: d.appName,
    value: d.downloads,
  }));

  return (
    <div className="space-y-4">
      <DonutChart data={donutData} />
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 font-medium">App</th>
              <th className="pb-2 text-right font-medium">Downloads</th>
              <th className="pb-2 text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1.5">{row.appName}</td>
                <td className="py-1.5 text-right">{row.downloads.toLocaleString()}</td>
                <td className="py-1.5 text-right text-muted-foreground">
                  {row.percentage != null ? `${row.percentage.toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DevicesView({ data }: { data: ScrapedDeviceEntry[] }) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No device data available.</p>;
  }

  const donutData = data.slice(0, 8).map((d) => ({
    name: d.deviceName ?? d.deviceType,
    value: d.downloads,
  }));

  return (
    <div className="space-y-4">
      <DonutChart data={donutData} />
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 font-medium">Device</th>
              <th className="pb-2 text-right font-medium">Type</th>
              <th className="pb-2 text-right font-medium">Downloads</th>
              <th className="pb-2 text-right font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1.5">{row.deviceName ?? "—"}</td>
                <td className="py-1.5 text-right text-muted-foreground">{row.deviceType}</td>
                <td className="py-1.5 text-right">{row.downloads.toLocaleString()}</td>
                <td className="py-1.5 text-right text-muted-foreground">
                  {row.percentage != null ? `${row.percentage.toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `podcasts/page.tsx` to include the listeners section**

Modify `src/app/dashboard/analytics/podcasts/page.tsx`. Add the new imports at the top:

```typescript
import ListenersSection from "@/components/analytics/listeners-section";
import {
  fetchAccessibleShows,
  fetchPodcastAnalytics,
  fetchPodcastEpisodes,
  fetchScrapedOverview,
  fetchScrapedGeo,
  fetchScrapedApps,
  fetchScrapedDevices,
} from "@/app/dashboard/analytics/actions";
import type {
  AccessibleShow,
  TransistorAnalyticsPoint,
  TransistorEpisode,
} from "@/lib/analytics/types";
import type {
  ScrapedOverviewData,
  ScrapedGeoEntry,
  ScrapedAppEntry,
  ScrapedDeviceEntry,
} from "@/app/dashboard/analytics/actions";
```

Add state variables after the existing state declarations (after line 29):

```typescript
const [scrapedOverview, setScrapedOverview] = useState<ScrapedOverviewData | null>(null);
const [scrapedGeo, setScrapedGeo] = useState<{ data: ScrapedGeoEntry[]; scrapedAt: Date | null }>({ data: [], scrapedAt: null });
const [scrapedApps, setScrapedApps] = useState<{ data: ScrapedAppEntry[]; scrapedAt: Date | null }>({ data: [], scrapedAt: null });
const [scrapedDevices, setScrapedDevices] = useState<{ data: ScrapedDeviceEntry[]; scrapedAt: Date | null }>({ data: [], scrapedAt: null });
```

In the `useEffect` that fetches data when show changes (the one with `Promise.all`), add the scraped data fetches:

```typescript
useEffect(() => {
  if (selectedShowId === null) return;

  setDataLoading(true);
  const dateRange = { from, to };

  Promise.all([
    fetchPodcastAnalytics(selectedShowId, dateRange),
    fetchPodcastEpisodes(selectedShowId),
    fetchScrapedOverview(selectedShowId),
    fetchScrapedGeo(selectedShowId),
    fetchScrapedApps(selectedShowId),
    fetchScrapedDevices(selectedShowId),
  ]).then(([analyticsData, episodesData, overview, geo, apps, devices]) => {
    setDownloads(analyticsData);
    setEpisodes(episodesData);
    setScrapedOverview(overview);
    setScrapedGeo(geo);
    setScrapedApps(apps);
    setScrapedDevices(devices);
    setDataLoading(false);
  });
}, [selectedShowId, from, to]);
```

In the stat cards grid, add an estimated subscribers card:

```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
  <StatCard
    title="Total Downloads"
    value={totalDownloads.toLocaleString()}
    loading={dataLoading}
  />
  <StatCard
    title="Avg per Episode"
    value={avgPerEpisode.toLocaleString()}
    loading={dataLoading}
  />
  <StatCard
    title="Episodes Published"
    value={episodes.length.toLocaleString()}
    loading={dataLoading}
  />
  <StatCard
    title="Est. Subscribers"
    value={scrapedOverview?.estimatedSubscribers?.toLocaleString() ?? "—"}
    subtitle={scrapedOverview?.scrapedAt ? `Updated ${new Date(scrapedOverview.scrapedAt).toLocaleDateString()}` : undefined}
    loading={dataLoading}
  />
</div>
```

After the episode table section, add the listeners section:

```tsx
{/* Listeners (scraped data) */}
<ListenersSection
  geo={scrapedGeo}
  apps={scrapedApps}
  devices={scrapedDevices}
  loading={dataLoading}
/>
```

- [ ] **Step 3: Verify the page builds without errors**

```bash
npm run build
```

Expected: Build succeeds (scraped data will be empty until the scraper runs, and the listeners section will be hidden when there's no data).

- [ ] **Step 4: Commit**

```bash
git add src/components/analytics/listeners-section.tsx src/app/dashboard/analytics/podcasts/page.tsx
git commit -m "feat: add Listeners section with geo, apps, and devices to podcast analytics"
```

---

### Task 14: Enrich the analytics overview page with scraped data

**Files:**
- Modify: `src/app/dashboard/analytics/page.tsx`

- [ ] **Step 1: Add scraped overview data to the overview page**

In `src/app/dashboard/analytics/page.tsx`, add the import:

```typescript
import { fetchScrapedOverview } from "./actions";
import type { ScrapedOverviewData } from "./actions";
```

Add state after existing state (after line 54):

```typescript
const [scrapedOverview, setScrapedOverview] = useState<ScrapedOverviewData | null>(null);
```

In `loadPodcastData`, add the scraped overview fetch alongside the existing calls:

```typescript
const loadPodcastData = useCallback(
  async (wpShowId: number) => {
    setPodcastLoading(true);
    setPodcastError(false);
    try {
      const [analytics, episodes, overview] = await Promise.all([
        fetchPodcastAnalytics(wpShowId, { from, to }),
        fetchPodcastEpisodes(wpShowId),
        fetchScrapedOverview(wpShowId),
      ]);
      setPodcastData(analytics);
      setPodcastEpisodes(episodes);
      setScrapedOverview(overview);
    } catch {
      setPodcastError(true);
    } finally {
      setPodcastLoading(false);
    }
  },
  [from, to]
);
```

Add an "Est. Subscribers" stat card to the existing grid (change to 4 columns):

```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
  <StatCard
    title="Total Downloads"
    value={loading ? "" : formatNumber(totalDownloads)}
    subtitle={`${from} – ${to}`}
    loading={podcastLoading}
  />
  <StatCard
    title="Est. Subscribers"
    value={scrapedOverview?.estimatedSubscribers != null ? formatNumber(scrapedOverview.estimatedSubscribers) : "—"}
    subtitle={scrapedOverview?.scrapedAt ? `Updated ${new Date(scrapedOverview.scrapedAt).toLocaleDateString()}` : "No data yet"}
    loading={podcastLoading}
  />
  <StatCard
    title="YouTube Views"
    value={loading ? "" : formatNumber(ytTotalViews)}
    subtitle={`${from} – ${to}`}
    loading={ytLoading}
  />
  <StatCard
    title="Watch Hours"
    value={loading ? "" : formatNumber(Math.round(watchHours / 60))}
    subtitle={`${from} – ${to}`}
    loading={ytLoading}
  />
</div>
```

- [ ] **Step 2: Verify it builds**

```bash
npm run build
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/analytics/page.tsx
git commit -m "feat: show estimated subscribers on analytics overview from scraped data"
```

---

## Phase 4: Scraper Discovery Run

### Task 15: Manual discovery run to verify dashboard structure

This task validates the scraper against the real Transistor dashboard. It must be done interactively.

**Files:** None (manual testing)

- [ ] **Step 1: Set up environment variables locally**

Create `scripts/transistor-scraper/.env`:

```
DATABASE_URL=postgresql://...@localhost:5434/swm_producer_portal
TRANSISTOR_SUNSET_EMAIL=<your email>
TRANSISTOR_SUNSET_PASSWORD=<your password>
TRANSISTOR_YDC_EMAIL=<your email>
TRANSISTOR_YDC_PASSWORD=<your password>
```

- [ ] **Step 2: Run the scraper in headed mode for discovery**

Temporarily change `headless: true` to `headless: false` in `auth.ts` so you can watch the browser navigate. Then run:

```bash
cd scripts/transistor-scraper
npx tsx index.ts
```

Watch the browser to:
1. Confirm login works
2. Confirm analytics pages load
3. Check the console output for intercepted response data
4. Note any URL patterns or response shapes that differ from expectations

- [ ] **Step 3: Adjust collector URL patterns and parser field names based on actual responses**

Update `collector.ts` and `parser.ts` if the actual Transistor dashboard uses different URL patterns or response shapes than we assumed.

- [ ] **Step 4: Verify data was written to the database**

```bash
npx prisma studio
```

Check each of the five scraped tables for data.

- [ ] **Step 5: Revert `headless: false` back to `headless: true`**

- [ ] **Step 6: Commit any adjustments**

```bash
cd ../..
git add scripts/transistor-scraper/
git commit -m "fix: adjust scraper for actual Transistor dashboard response shapes"
```

---

## Phase 5: Deployment

### Task 16: Deploy scraper as a Railway cron service

This task is done in the Railway dashboard.

- [ ] **Step 1: In Railway staging environment, add a new service for the scraper**

1. Click "New Service" > "From Repo"
2. Point to the same GitHub repo
3. Set the root directory to `scripts/transistor-scraper`
4. Set the Dockerfile path to `scripts/transistor-scraper/Dockerfile`

- [ ] **Step 2: Configure environment variables for the scraper service**

Set:
- `DATABASE_URL` (same as the portal's staging database)
- `TRANSISTOR_SUNSET_EMAIL`
- `TRANSISTOR_SUNSET_PASSWORD`
- `TRANSISTOR_YDC_EMAIL`
- `TRANSISTOR_YDC_PASSWORD`
- `RESEND_API_KEY` (same as portal)

- [ ] **Step 3: Configure the cron schedule**

In the scraper service settings, set:
- Schedule: `0 3 * * 0` (3 AM UTC every Sunday)

- [ ] **Step 4: Trigger a manual run to verify**

Use Railway's manual trigger to run the scraper once. Check the portal's staging environment to verify:
1. Scraped data appears in Prisma Studio
2. Analytics pages show the new listeners section with real data
3. Scraper health log shows a successful run

- [ ] **Step 5: Verify staging portal shows scraped data correctly**

Visit the staging URL, go to Analytics > Podcasts, and confirm:
- Estimated subscribers card shows a value
- Listeners section shows geography, apps, and devices tabs with data
- "Updated" badges show correct timestamps

---

### Task 17: Promote to production

- [ ] **Step 1: Merge `main` to `production`**

```bash
git checkout production
git merge main
git push origin production
```

- [ ] **Step 2: Replicate the scraper service in the production Railway environment**

Same setup as Task 16, but pointing to production database and environment variables.

- [ ] **Step 3: Verify production deployment**

Confirm the production portal shows the new analytics features and the scraper is scheduled.
