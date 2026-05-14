"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { synthesizeForShow } from "@/lib/style-guide/synthesis";

interface ActionResult {
  success: boolean;
  message: string;
  styleGuide?: string;
}

export async function synthesizeStyleGuide(
  wpShowId: number
): Promise<ActionResult> {
  await requireAdmin();
  return synthesizeForShow(wpShowId);
}
