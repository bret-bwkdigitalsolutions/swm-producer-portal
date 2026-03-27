/**
 * Smoke test script for the SWM Producer Portal.
 *
 * Usage:
 *   npx tsx scripts/smoke-test.ts <base-url>
 *
 * Example:
 *   npx tsx scripts/smoke-test.ts https://portal.stolenwatermedia.com
 *   npx tsx scripts/smoke-test.ts http://localhost:3000
 *
 * Environment variables (optional, for authenticated tests):
 *   SMOKE_TEST_EMAIL    — email of a test user
 *   SMOKE_TEST_PASSWORD — password of a test user
 *   SMOKE_TEST_IS_ADMIN — set to "true" if the test user is an admin
 *
 * Exits with code 0 on all tests passing, 1 on any failure.
 */

// ---------------------------------------------------------------------------
// Color helpers (ANSI)
// ---------------------------------------------------------------------------

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function pass(label: string, detail?: string) {
  const extra = detail ? ` ${DIM}${detail}${RESET}` : "";
  console.log(`  ${GREEN}PASS${RESET}  ${label}${extra}`);
}

function fail(label: string, detail?: string) {
  const extra = detail ? ` ${DIM}${detail}${RESET}` : "";
  console.log(`  ${RED}FAIL${RESET}  ${label}${extra}`);
}

function skip(label: string, reason: string) {
  console.log(`  ${YELLOW}SKIP${RESET}  ${label} ${DIM}(${reason})${RESET}`);
}

function header(text: string) {
  console.log(`\n${CYAN}${BOLD}${text}${RESET}`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestResult {
  label: string;
  passed: boolean;
  skipped?: boolean;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const results: TestResult[] = [];

async function test(
  label: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
    pass(label);
    results.push({ label, passed: true });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : String(error);
    fail(label, detail);
    results.push({ label, passed: false, detail });
  }
}

function skipTest(label: string, reason: string): void {
  skip(label, reason);
  results.push({ label, passed: true, skipped: true });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = process.argv[2];

if (!BASE_URL) {
  console.error(
    `${RED}Usage: npx tsx scripts/smoke-test.ts <base-url>${RESET}`
  );
  console.error(
    `${DIM}Example: npx tsx scripts/smoke-test.ts http://localhost:3000${RESET}`
  );
  process.exit(1);
}

// Strip trailing slash
const baseUrl = BASE_URL.replace(/\/$/, "");

/**
 * Fetch with redirect disabled so we can inspect redirect responses.
 */
async function fetchNoRedirect(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    redirect: "manual",
  });
}

/**
 * Fetch that follows redirects (default behavior).
 */
async function fetchFollow(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, options);
}

/**
 * Extract cookies from a Set-Cookie header.
 */
function extractCookies(response: Response): string {
  const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
  return setCookieHeaders
    .map((c) => c.split(";")[0])
    .join("; ");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    `\n${BOLD}SWM Producer Portal — Smoke Tests${RESET}`
  );
  console.log(`${DIM}Target: ${baseUrl}${RESET}`);

  // -----------------------------------------------------------------------
  // Unauthenticated tests
  // -----------------------------------------------------------------------

  header("Unauthenticated");

  await test("GET / → redirects to /dashboard or /login", async () => {
    const res = await fetchNoRedirect("/");
    const location = res.headers.get("location") ?? "";
    assert(
      res.status >= 300 && res.status < 400,
      `Expected redirect, got ${res.status}`
    );
    assert(
      location.includes("/dashboard") || location.includes("/login"),
      `Unexpected redirect target: ${location}`
    );
  });

  await test("GET /login → 200 with expected content", async () => {
    const res = await fetchFollow("/login");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.text();
    assert(
      body.includes("SWM") || body.includes("Producer Portal") || body.includes("Sign in") || body.includes("Login"),
      "Page does not contain expected portal branding"
    );
  });

  await test("GET /api/auth/session → returns JSON", async () => {
    const res = await fetchFollow("/api/auth/session");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    assert(
      contentType.includes("application/json"),
      `Expected JSON content-type, got: ${contentType}`
    );
    // Should be valid JSON (empty object for unauthenticated)
    const json = await res.json();
    assert(typeof json === "object", "Response is not a JSON object");
  });

  await test(
    "GET /dashboard → redirects to /login (unauthenticated)",
    async () => {
      const res = await fetchNoRedirect("/dashboard");
      // Next.js middleware or server-side redirect
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location") ?? "";
        assert(
          location.includes("/login"),
          `Expected redirect to /login, got: ${location}`
        );
      } else if (res.status === 200) {
        // Could be a client-side redirect via the page itself
        const body = await res.text();
        assert(
          body.includes("/login") || body.includes("Sign in"),
          "Expected login redirect or sign-in page content"
        );
      } else {
        throw new Error(`Unexpected status: ${res.status}`);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Authenticated tests (optional)
  // -----------------------------------------------------------------------

  const testEmail = process.env.SMOKE_TEST_EMAIL;
  const testPassword = process.env.SMOKE_TEST_PASSWORD;
  const isAdmin = process.env.SMOKE_TEST_IS_ADMIN === "true";

  header("Authenticated");

  if (!testEmail || !testPassword) {
    skipTest(
      "POST /api/auth/callback/credentials → authenticates",
      "SMOKE_TEST_EMAIL / SMOKE_TEST_PASSWORD not set"
    );
    skipTest("GET /dashboard (authenticated) → 200", "no credentials");
    skipTest(
      "GET /admin (authenticated) → 200 or redirect",
      "no credentials"
    );
    skipTest(
      "GET /dashboard/review (authenticated) → 200 or graceful error",
      "no credentials"
    );
  } else {
    let sessionCookies = "";

    await test(
      "POST /api/auth/callback/credentials → authenticates",
      async () => {
        // First, get CSRF token from the signin page
        const csrfRes = await fetchFollow("/api/auth/csrf");
        assert(
          csrfRes.status === 200,
          `CSRF fetch failed: ${csrfRes.status}`
        );
        const csrfJson = (await csrfRes.json()) as { csrfToken: string };
        const csrfToken = csrfJson.csrfToken;
        assert(!!csrfToken, "No CSRF token returned");

        const csrfCookies = extractCookies(csrfRes);

        // Perform credentials login
        const loginRes = await fetchNoRedirect(
          "/api/auth/callback/credentials",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Cookie: csrfCookies,
            },
            body: new URLSearchParams({
              email: testEmail,
              password: testPassword,
              csrfToken,
            }).toString(),
          }
        );

        // NextAuth redirects on success (302/307)
        assert(
          loginRes.status >= 200 && loginRes.status < 400,
          `Login failed with status ${loginRes.status}`
        );

        // Collect session cookies
        const loginCookies = extractCookies(loginRes);
        sessionCookies = [csrfCookies, loginCookies]
          .filter(Boolean)
          .join("; ");

        assert(
          sessionCookies.length > 0,
          "No session cookies received after login"
        );
      }
    );

    if (sessionCookies) {
      await test("GET /dashboard (authenticated) → 200", async () => {
        const res = await fetchFollow("/dashboard", {
          headers: { Cookie: sessionCookies },
        });
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
      });

      await test(
        "GET /admin (authenticated) → 200 or redirect",
        async () => {
          const res = await fetchNoRedirect("/admin", {
            headers: { Cookie: sessionCookies },
          });

          if (isAdmin) {
            // Admin should get 200 (possibly after redirect to /admin/...)
            assert(
              res.status === 200 ||
                (res.status >= 300 && res.status < 400),
              `Expected 200 or redirect for admin, got ${res.status}`
            );
          } else {
            // Non-admin should be redirected away
            assert(
              res.status >= 300 && res.status < 400,
              `Expected redirect for non-admin, got ${res.status}`
            );
          }
        }
      );

      await test(
        "GET /dashboard/review (authenticated) → 200 or graceful error",
        async () => {
          const res = await fetchFollow("/dashboard/review", {
            headers: { Cookie: sessionCookies },
          });
          // 200 = page rendered, 302/307 = access redirect, 500 = server error
          assert(
            res.status === 200 ||
              (res.status >= 300 && res.status < 400),
            `Unexpected status: ${res.status}`
          );
        }
      );
    } else {
      skipTest(
        "GET /dashboard (authenticated) → 200",
        "login did not return session"
      );
      skipTest(
        "GET /admin (authenticated) → 200 or redirect",
        "login did not return session"
      );
      skipTest(
        "GET /dashboard/review (authenticated) → 200 or graceful error",
        "login did not return session"
      );
    }
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------

  header("Summary");

  const passed = results.filter((r) => r.passed && !r.skipped).length;
  const failed = results.filter((r) => !r.passed).length;
  const skipped = results.filter((r) => r.skipped).length;
  const total = results.length;

  console.log(
    `  ${GREEN}${passed} passed${RESET}` +
      (failed > 0 ? `, ${RED}${failed} failed${RESET}` : "") +
      (skipped > 0 ? `, ${YELLOW}${skipped} skipped${RESET}` : "") +
      ` ${DIM}(${total} total)${RESET}`
  );

  if (failed > 0) {
    console.log(`\n${RED}${BOLD}Some tests failed.${RESET}\n`);
    process.exit(1);
  } else {
    console.log(`\n${GREEN}${BOLD}All tests passed.${RESET}\n`);
    process.exit(0);
  }
}

main().catch((error) => {
  console.error(`\n${RED}Unexpected error:${RESET}`, error);
  process.exit(1);
});
