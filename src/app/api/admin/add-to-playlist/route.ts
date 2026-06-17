import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { addToPlaylist } from "@/lib/platforms/youtube";

/**
 * Temporary admin endpoint to add a video to a YouTube playlist.
 * DELETE THIS after use.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { wpShowId, playlistId, videoId } = await request.json();
  if (!wpShowId || !playlistId || !videoId) {
    return NextResponse.json({ error: "Missing wpShowId, playlistId, or videoId" }, { status: 400 });
  }

  try {
    await addToPlaylist(wpShowId, playlistId, videoId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
