"use client";

import { useOptimistic, useTransition } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2Icon } from "lucide-react";
import { setShirtShipped } from "./actions";

/**
 * Inline "Shipped" toggle for a subscriber row. Optimistically flips the
 * checkbox, then PATCHes the shipped flag straight to WordPress via the
 * existing admin-only `setShirtShipped` action (which revalidates the list).
 * Only rendered for subscribers whose shirt is claimed (see `canShipShirt`).
 */
export function ShirtShippedCheckbox({
  id,
  shipped,
}: {
  id: number;
  shipped: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticShipped, setOptimisticShipped] = useOptimistic(shipped);

  function onToggle(next: boolean) {
    startTransition(async () => {
      setOptimisticShipped(next);
      const formData = new FormData();
      formData.set("id", String(id));
      formData.set("shipped", String(next));
      await setShirtShipped({}, formData);
    });
  }

  const checkboxId = `ship-${id}`;
  return (
    <label
      htmlFor={checkboxId}
      className="flex w-fit cursor-pointer items-center gap-2 text-xs"
    >
      <Checkbox
        id={checkboxId}
        checked={optimisticShipped}
        onCheckedChange={onToggle}
        disabled={isPending}
        aria-label="Shipped"
      />
      {isPending ? (
        <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
      ) : (
        <span
          className={
            optimisticShipped
              ? "text-green-700 dark:text-green-400"
              : "text-muted-foreground"
          }
        >
          {optimisticShipped ? "Shipped" : "Ship"}
        </span>
      )}
    </label>
  );
}
