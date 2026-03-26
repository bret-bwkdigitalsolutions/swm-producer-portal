"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { checkCredentialHealth } from "./actions";

export function HealthCheckButton() {
  const [state, action, isPending] = useActionState(checkCredentialHealth, {
    success: undefined,
    message: undefined,
  });

  return (
    <div className="flex items-center gap-2">
      {state?.message && (
        <span
          className={`text-xs ${state.success ? "text-green-600" : "text-red-600"}`}
        >
          {state.message}
        </span>
      )}
      <form action={action}>
        <Button variant="outline" size="sm" type="submit" disabled={isPending}>
          {isPending ? "Checking..." : "Check Health"}
        </Button>
      </form>
    </div>
  );
}
