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

  // The url field stores the numeric Transistor show ID
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

      // Parse and store overview (from daily_average + subscribers + overall)
      const overview = parseOverview(data, wpShowId, scrapedAt);
      await upsertOverview(overview);

      // Parse and store geo (from countries_map)
      const geo = parseGeo(data.countriesMap, wpShowId, scrapedAt);
      if (geo.length > 0) {
        await upsertGeo(geo);
      }

      // Parse and store apps
      const apps = parseApps(data.apps, wpShowId, scrapedAt);
      if (apps.length > 0) {
        await upsertApps(apps);
      }

      // Parse and store devices + platforms (from DOM)
      const devices = parseDevices(data.devices, data.platforms, wpShowId, scrapedAt);
      if (devices.length > 0) {
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
