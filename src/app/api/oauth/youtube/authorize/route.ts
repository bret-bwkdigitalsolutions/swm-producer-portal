import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getYouTubeAuthUrl } from "@/lib/youtube-oauth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const wpShowId = request.nextUrl.searchParams.get("showId") ?? "0";
  const showIdNum = parseInt(wpShowId, 10);

  if (isNaN(showIdNum) || showIdNum < 0) {
    return NextResponse.redirect(
      new URL("/admin/credentials?error=invalid_show", request.url)
    );
  }

  const authUrl = getYouTubeAuthUrl(showIdNum);
  return NextResponse.redirect(authUrl);
}
