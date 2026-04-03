import "server-only";

const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedAuth: any = null;

function buildAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  }

  const credentials = JSON.parse(keyJson);

  // Dynamic import to avoid edge runtime bundling
  const { auth } = require("@googleapis/docs") as typeof import("@googleapis/docs");

  return new auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
}

export function getGoogleAuth() {
  if (!cachedAuth) {
    cachedAuth = buildAuth();
  }
  return cachedAuth;
}
