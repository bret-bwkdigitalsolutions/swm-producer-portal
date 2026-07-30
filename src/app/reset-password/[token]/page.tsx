import Link from "next/link";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resetTokenStatus } from "@/lib/password-reset-token";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const reset = await db.passwordResetToken.findUnique({
    where: { token },
    include: { user: { select: { name: true } } },
  });

  const status = resetTokenStatus(reset, new Date());

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Reset your password</CardTitle>
        </CardHeader>
        <CardContent>
          {status === "valid" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                {reset?.user.name ? `Hi ${reset.user.name}, c` : "C"}hoose a new
                password for your account.
              </p>
              <ResetPasswordForm token={token} />
            </div>
          ) : status === "used" ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                This reset link has already been used.
              </p>
              <Link href="/login" className="text-sm font-medium text-primary underline">
                Sign in here
              </Link>
            </div>
          ) : (
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                {status === "expired"
                  ? "This reset link has expired."
                  : "This reset link is invalid."}{" "}
                Please request a new one.
              </p>
              <Link
                href="/forgot-password"
                className="text-sm font-medium text-primary underline"
              >
                Request a new link
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
