import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetPasswordForm } from "./set-password-form";
import Link from "next/link";

export default async function SetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invite = await db.inviteToken.findUnique({
    where: { token },
    include: { user: { select: { name: true, email: true } } },
  });

  const isExpired = invite ? invite.expiresAt < new Date() : false;
  const isUsed = invite ? !!invite.usedAt : false;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">SWM Producer Portal</CardTitle>
        </CardHeader>
        <CardContent>
          {!invite ? (
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                This invite link is invalid. Please contact your admin for a new
                one.
              </p>
            </div>
          ) : isUsed ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                You've already set up your account.
              </p>
              <Link
                href="/login"
                className="text-sm font-medium text-primary underline"
              >
                Sign in here
              </Link>
            </div>
          ) : isExpired ? (
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                This invite link has expired. Please contact your admin for a
                new one.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                Welcome{invite.user.name ? `, ${invite.user.name}` : ""}! Create
                a password to access your account.
              </p>
              <SetPasswordForm token={token} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
