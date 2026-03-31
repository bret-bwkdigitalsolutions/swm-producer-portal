import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = process.env.WP_APP_USER ?? "(not set)";
  const pass = process.env.WP_APP_PASSWORD ?? "(not set)";

  // Test the actual WP auth
  const authHeader =
    "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

  let wpResult: string;
  try {
    const res = await fetch(`${process.env.WP_API_URL}/users/me`, {
      headers: { Authorization: authHeader },
    });
    const body = await res.text();
    wpResult = `${res.status}: ${body.slice(0, 200)}`;
  } catch (e) {
    wpResult = `Error: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json({
    wp_app_user: user,
    wp_app_password_length: pass.length,
    wp_app_password_first4: pass.slice(0, 4),
    wp_api_url: process.env.WP_API_URL ?? "(not set)",
    wp_test_result: wpResult,
  });
}
