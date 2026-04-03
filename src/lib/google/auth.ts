import "server-only";
import * as crypto from "crypto";

const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
];

const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function base64url(data: string | Buffer): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function createJwt(credentials: ServiceAccountCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: credentials.client_email,
    scope: SCOPES.join(" "),
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signInput = `${headerB64}.${payloadB64}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = sign.sign(credentials.private_key);

  return `${signInput}.${base64url(signature)}`;
}

function getCredentials(): ServiceAccountCredentials {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  }
  return JSON.parse(keyJson);
}

export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const credentials = getCredentials();
  const jwt = createJwt(credentials);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to get Google access token: ${res.status} ${body}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.token;
}
