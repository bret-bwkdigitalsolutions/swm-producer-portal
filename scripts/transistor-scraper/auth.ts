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
    throw new Error(
      `Missing credentials for ${account}: set ${envKeys.email} and ${envKeys.password}`
    );
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
  await page.fill(
    'input[type="password"], input[name="password"]',
    config.password
  );
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
