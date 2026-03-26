"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function updateVisibilityPreferences(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const visibleContentTypes = formData.getAll("contentTypes") as string[];
  const visibleShowIds = formData
    .getAll("shows")
    .map((id) => parseInt(id as string, 10))
    .filter((id) => !isNaN(id));

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      allowedContentTypes: true,
      allowedShows: true,
    },
  });

  if (!user) throw new Error("User not found");

  const allowedTypes = user.allowedContentTypes.map((ct) => ct.contentType);
  const allowedShowIds = user.allowedShows.map((s) => s.wpShowId);

  const validTypes = visibleContentTypes.filter((t) =>
    allowedTypes.includes(t)
  );
  const validShowIds = visibleShowIds.filter((id) =>
    allowedShowIds.includes(id)
  );

  await db.userPreference.upsert({
    where: { userId: session.user.id },
    update: {
      visibleContentTypes: validTypes,
      visibleShowIds: validShowIds,
    },
    create: {
      userId: session.user.id,
      visibleContentTypes: validTypes,
      visibleShowIds: validShowIds,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  redirect("/settings?saved=true");
}
