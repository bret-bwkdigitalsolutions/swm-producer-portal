import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyContentTypeAccess } from "@/lib/auth-guard";
import { ContentType } from "@/lib/constants";
import { compressForWordPress } from "@/lib/image";
import { uploadMedia } from "@/lib/wordpress/client";
import { WpApiError } from "@/lib/wordpress/types";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_SIZE = 15 * 1024 * 1024; // 15 MB per file (well above iPhone JPEG)

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hasAccess = await verifyContentTypeAccess(
    session.user.id,
    session.user.role,
    ContentType.APPEARANCE
  );
  if (!hasAccess) {
    return NextResponse.json(
      { error: "You do not have access to appearances." },
      { status: 403 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return NextResponse.json(
      { error: "No file provided." },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_SIZE / 1024 / 1024} MB).` },
      { status: 413 }
    );
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}` },
      { status: 415 }
    );
  }

  try {
    const compressed = await compressForWordPress(file);
    const uploaded = await uploadMedia(compressed);
    return NextResponse.json({
      id: uploaded.id,
      url: uploaded.source_url,
      filename: file.name,
    });
  } catch (error) {
    console.error("[upload/appearance-gallery] Failed:", error);
    if (error instanceof WpApiError) {
      return NextResponse.json(
        { error: `WordPress error: ${error.message}` },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "Upload failed." },
      { status: 500 }
    );
  }
}
