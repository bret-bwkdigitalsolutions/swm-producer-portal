"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

interface FormState {
  success?: boolean;
  message?: string;
}

export async function addStakeholder(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  const wpShowId = parseInt(formData.get("wp_show_id") as string, 10);
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const name = (formData.get("name") as string)?.trim();

  if (!wpShowId || isNaN(wpShowId)) {
    return { success: false, message: "Invalid show." };
  }
  if (!email) {
    return { success: false, message: "Email is required." };
  }
  if (!name) {
    return { success: false, message: "Name is required." };
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { success: false, message: "Invalid email address." };
  }

  try {
    await db.showStakeholder.create({
      data: { wpShowId, email, name },
    });
    return { success: true, message: `Added ${name} as a stakeholder.` };
  } catch (error: unknown) {
    // Handle unique constraint violation
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return {
        success: false,
        message: "This email is already a stakeholder for this show.",
      };
    }
    console.error("Failed to add stakeholder:", error);
    return { success: false, message: "Failed to add stakeholder." };
  }
}

export async function removeStakeholder(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Unauthorized." };
  }

  const id = formData.get("id") as string;
  if (!id) {
    return { success: false, message: "Stakeholder ID is required." };
  }

  try {
    await db.showStakeholder.delete({ where: { id } });
    return { success: true, message: "Stakeholder removed." };
  } catch {
    return { success: false, message: "Failed to remove stakeholder." };
  }
}
