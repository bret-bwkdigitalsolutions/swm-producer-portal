"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCwIcon, Loader2Icon, CheckCircle2Icon } from "lucide-react";
import { refreshShowCache } from "./actions";

export function RefreshShowsButton() {
  const [state, formAction, isPending] = useActionState(
    async () => refreshShowCache(),
    {}
  );

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <RefreshCwIcon className="size-4" />
        )}
        {isPending ? "Refreshing..." : "Refresh from WordPress"}
      </Button>
      {state.success && (
        <span className="inline-flex items-center gap-1 text-xs text-green-600">
          <CheckCircle2Icon className="size-3" />
          Updated
        </span>
      )}
    </form>
  );
}
