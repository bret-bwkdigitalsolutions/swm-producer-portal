/**
 * One-time script to get a Google OAuth2 refresh token.
 *
 * Usage:
 *   GOOGLE_DOCS_CLIENT_ID=xxx GOOGLE_DOCS_CLIENT_SECRET=yyy node scripts/get-google-refresh-token.mjs
 *
 * Opens a browser for consent, then prints the refresh token.
 */

import http from "node:http";
import { URL } from "node:url";

const CLIENT_ID = process.env.GOOGLE_DOCS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_DOCS_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/oauth/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_DOCS_CLIENT_ID and GOOGLE_DOCS_CLIENT_SECRET env vars");
  process.exit(1);
}

// 1. Build the auth URL
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl.toString());
console.log("\nWaiting for callback on http://localhost:3000 ...\n");

// 2. Start a temporary server to catch the redirect
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:3000");

  if (!url.pathname.startsWith("/oauth/callback")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400);
    res.end("No code in callback");
    return;
  }

  // 3. Exchange code for tokens
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const data = await tokenRes.json();

    if (data.error) {
      res.writeHead(400);
      res.end(`Error: ${data.error_description || data.error}`);
      console.error("Token exchange failed:", data);
      process.exit(1);
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>Success!</h1><p>You can close this tab.</p>");

    console.log("=== Add these to your Railway env vars ===\n");
    console.log(`GOOGLE_DOCS_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GOOGLE_DOCS_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GOOGLE_DOCS_REFRESH_TOKEN=${data.refresh_token}`);
    console.log("");

    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500);
    res.end("Token exchange failed");
    console.error(err);
    process.exit(1);
  }
});

server.listen(3000);
