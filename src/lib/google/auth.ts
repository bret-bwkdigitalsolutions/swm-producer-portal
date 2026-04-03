import "server-only";
import { auth } from "@googleapis/docs";

const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
];

let cachedAuth: InstanceType<typeof auth.GoogleAuth> | null = null;

function buildAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  }

  const credentials = JSON.parse(keyJson);

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
