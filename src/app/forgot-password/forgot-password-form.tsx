"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Shown on submit regardless of whether the email maps to a real account, to
// avoid leaking which emails are registered (account enumeration). Lives here,
// not in actions.ts, because a "use server" file can't export a string.
const GENERIC_SUCCESS =
  "If an account exists for that email, we've sent a link to reset the password. Check your inbox.";

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(requestPasswordReset, null);

  if (state?.sent) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">{GENERIC_SUCCESS}</p>
        <Link href="/login" className="text-sm font-medium text-primary underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enter your email and we&apos;ll send you a link to reset your password.
      </p>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@example.com"
        />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Sending..." : "Send reset link"}
      </Button>

      <div className="text-center">
        <Link href="/login" className="text-sm text-muted-foreground underline">
          Back to sign in
        </Link>
      </div>
    </form>
  );
}
