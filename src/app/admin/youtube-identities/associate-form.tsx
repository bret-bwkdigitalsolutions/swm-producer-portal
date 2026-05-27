"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { associateCredential } from "./actions";

interface AssociateFormProps {
  credentialId: string;
  identities: { email: string; channelTitle: string | null }[];
}

const initialState = { success: undefined, message: undefined };

export function AssociateForm({
  credentialId,
  identities,
}: AssociateFormProps) {
  const [state, formAction, isPending] = useActionState(
    associateCredential,
    initialState
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="credentialId" value={credentialId} />
      <Select name="email">
        <SelectTrigger className="h-9 w-72">
          <SelectValue placeholder="Pick an identity…" />
        </SelectTrigger>
        <SelectContent>
          {identities.map((i) => (
            <SelectItem key={i.email} value={i.email}>
              {i.channelTitle ? `${i.channelTitle} — ${i.email}` : i.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Linking…" : "Link"}
      </Button>
      {state?.message && (
        <span
          className={
            state.success ? "text-sm text-green-700" : "text-sm text-red-700"
          }
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
