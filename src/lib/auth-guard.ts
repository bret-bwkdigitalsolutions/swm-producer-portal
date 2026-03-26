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

/**
 * Verify a user has access to a specific show. For use in server actions
 * (returns boolean instead of redirecting).
 */
export async function verifyShowAccess(
  userId: string,
  wpShowId: number
): Promise<boolean> {
  const access = await db.userShowAccess.findUnique({
    where: { userId_wpShowId: { userId, wpShowId } },
  });
  return !!access;
}

/**
 * Verify a user has access to a specific content type. For use in server actions.
 */
export async function verifyContentTypeAccess(
  userId: string,
  role: string,
  contentType: string
): Promise<boolean> {
  if (role === "admin") return true;
  const access = await db.userContentTypeAccess.findUnique({
    where: { userId_contentType: { userId, contentType } },
  });
  return !!access;
}
