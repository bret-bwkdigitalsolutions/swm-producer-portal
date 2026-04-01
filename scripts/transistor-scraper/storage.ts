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

export async function createScrapeLog(account: string): Promise<string> {
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
