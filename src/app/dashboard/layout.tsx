import { requireAuth } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      allowedContentTypes: true,
      preferences: true,
    },
  });

  const allowedTypes =
    user?.allowedContentTypes.map((ct) => ct.contentType) ?? [];
  const visibleTypes =
    user?.preferences?.visibleContentTypes ?? allowedTypes;
  const effectiveTypes = visibleTypes.filter((t) => allowedTypes.includes(t));

  return (
    <div className="flex h-screen flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar visibleContentTypes={effectiveTypes} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
