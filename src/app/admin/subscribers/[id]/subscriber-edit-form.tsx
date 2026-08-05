"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2Icon } from "lucide-react";
import { saveSubscriber, setShirtShipped } from "../actions";
import { SHIRT_SIZES } from "@/lib/membership/types";
import type { Shirt } from "@/lib/membership/types";

export function SubscriberEditForm({
  id,
  displayName,
  shirt,
}: {
  id: number;
  displayName: string;
  shirt: Shirt | null;
}) {
  const [saveState, saveAction, saving] = useActionState(saveSubscriber, {});
  const [shipState, shipAction, shipping] = useActionState(setShirtShipped, {});
  const isShipped = !!shirt?.shipped_at;

  return (
    <div className="space-y-4">
      {/* Ship toggle — its own form so it can act independently of the edit save. */}
      <form action={shipAction} className="flex items-center gap-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="shipped" value={(!isShipped).toString()} />
        <Button
          type="submit"
          variant={isShipped ? "outline" : "default"}
          size="sm"
          disabled={shipping || !shirt?.size}
        >
          {shipping ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : isShipped ? (
            "Mark not shipped"
          ) : (
            "Mark shipped"
          )}
        </Button>
        {isShipped && (
          <span className="text-xs text-muted-foreground">
            Shipped — clearing resets the fulfillment status.
          </span>
        )}
        {!shirt?.size && (
          <span className="text-xs text-muted-foreground">
            No shirt size on file yet.
          </span>
        )}
        {shipState.message && (
          <span
            className={`text-xs ${shipState.success ? "text-green-700 dark:text-green-400" : "text-destructive"}`}
          >
            {shipState.message}
          </span>
        )}
      </form>

      <form action={saveAction} className="space-y-4 border-t pt-4">
        <input type="hidden" name="id" value={id} />

        <div className="space-y-1">
          <Label htmlFor={`name-${id}`} className="text-xs">
            Display name
          </Label>
          <Input
            id={`name-${id}`}
            name="display_name"
            defaultValue={displayName}
            className="h-9"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Shirt size</Label>
            <Select name="shirt_size" defaultValue={shirt?.size ?? ""}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {SHIRT_SIZES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`shipname-${id}`} className="text-xs">
              Ship-to name
            </Label>
            <Input
              id={`shipname-${id}`}
              name="ship_name"
              defaultValue={shirt?.name ?? ""}
              className="h-9"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`addr1-${id}`} className="text-xs">
            Address line 1
          </Label>
          <Input
            id={`addr1-${id}`}
            name="address_line1"
            defaultValue={shirt?.address_line1 ?? ""}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`addr2-${id}`} className="text-xs">
            Address line 2
          </Label>
          <Input
            id={`addr2-${id}`}
            name="address_line2"
            defaultValue={shirt?.address_line2 ?? ""}
            className="h-9"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`city-${id}`} className="text-xs">
              City
            </Label>
            <Input
              id={`city-${id}`}
              name="city"
              defaultValue={shirt?.city ?? ""}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`region-${id}`} className="text-xs">
              State
            </Label>
            <Input
              id={`region-${id}`}
              name="region"
              defaultValue={shirt?.region ?? ""}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`zip-${id}`} className="text-xs">
              ZIP
            </Label>
            <Input
              id={`zip-${id}`}
              name="postal_code"
              defaultValue={shirt?.postal_code ?? ""}
              className="h-9"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`country-${id}`} className="text-xs">
            Country
          </Label>
          <Input
            id={`country-${id}`}
            name="country"
            defaultValue={shirt?.country ?? "US"}
            className="h-9 w-24"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              "Save changes"
            )}
          </Button>
          {saveState.message && (
            <span
              className={`text-sm ${saveState.success ? "text-green-700 dark:text-green-400" : "text-destructive"}`}
            >
              {saveState.message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
