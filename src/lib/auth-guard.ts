import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

export async function requireAdmin() {
  const session = await requireAuth();
  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }
  return session;
}

export async function requireContentTypeAccess(contentType: string) {
  const session = await requireAuth();

  // Admins can access everything
  if (session.user.role === "admin") return session;

  const access = await db.userContentTypeAccess.findUnique({
    where: {
      userId_contentType: {
        userId: session.user.id,
        contentType,
      },
    },
  });

  if (!access) {
    redirect("/dashboard");
  }

  return session;
}
