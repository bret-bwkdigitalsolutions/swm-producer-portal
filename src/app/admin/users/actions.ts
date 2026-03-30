"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAndSendInvite } from "@/lib/invite";

async function requireAdminSession() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function inviteUser(formData: FormData) {
  await requireAdminSession();

  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const role = formData.get("role") as string;

  if (!name || !email || !role) {
    throw new Error("All fields are required");
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error("A user with this email already exists");
  }

  const user = await db.user.create({
    data: { name, email, role },
  });

  revalidatePath("/admin/users");
  redirect(`/admin/users/${user.id}`);
}

export async function sendInvite(formData: FormData) {
  await requireAdminSession();

  const userId = formData.get("userId") as string;
  if (!userId) {
    throw new Error("User ID is required");
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });

  if (!user) {
    throw new Error("User not found");
  }

  await createAndSendInvite({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  redirect(`/admin/users/${userId}?invited=true`);
}

export async function updateUserPermissions(formData: FormData) {
  await requireAdminSession();

  const userId = formData.get("userId") as string;
  const role = formData.get("role") as string;
  const hasDistributionAccess = formData.get("hasDistributionAccess") === "on";
  const contentTypes = formData.getAll("contentTypes") as string[];
  const existingShowIds = formData
    .getAll("showIds")
    .map((id) => parseInt(id as string, 10))
    .filter((id) => !isNaN(id));

  // Handle new show ID added from the form
  const newShowIdStr = formData.get("newShowId") as string;
  const newShowId = newShowIdStr ? parseInt(newShowIdStr, 10) : NaN;
  const showIds = isNaN(newShowId)
    ? existingShowIds
    : [...existingShowIds, newShowId];

  if (!userId || !role) {
    throw new Error("User ID and role are required");
  }

  await db.$transaction(async (tx) => {
    // Update user role and distribution access
    await tx.user.update({
      where: { id: userId },
      data: { role, hasDistributionAccess },
    });

    // Replace content type access
    await tx.userContentTypeAccess.deleteMany({ where: { userId } });
    if (contentTypes.length > 0) {
      await tx.userContentTypeAccess.createMany({
        data: contentTypes.map((contentType) => ({ userId, contentType })),
      });
    }

    // Replace show access
    await tx.userShowAccess.deleteMany({ where: { userId } });
    if (showIds.length > 0) {
      await tx.userShowAccess.createMany({
        data: showIds.map((wpShowId) => ({ userId, wpShowId })),
      });
    }
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  redirect(`/admin/users/${userId}?saved=true`);
}

export async function deleteUser(formData: FormData) {
  const session = await requireAdminSession();

  const userId = formData.get("userId") as string;

  if (!userId) {
    throw new Error("User ID is required");
  }

  // Prevent self-deletion
  if (userId === session.user.id) {
    throw new Error("You cannot delete your own account");
  }

  await db.user.delete({ where: { id: userId } });

  revalidatePath("/admin/users");
  redirect("/admin/users?deleted=true");
}
