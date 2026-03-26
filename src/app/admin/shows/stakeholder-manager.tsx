"use client";

import { useActionState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addStakeholder, removeStakeholder } from "./actions";
import { Loader2Icon, XIcon } from "lucide-react";

interface Stakeholder {
  id: string;
  email: string;
  name: string;
}

interface ShowStakeholderManagerProps {
  wpShowId: number;
  showName: string;
  stakeholders: Stakeholder[];
}

function RemoveStakeholderButton({ stakeholder }: { stakeholder: Stakeholder }) {
  const [state, formAction, isPending] = useActionState(removeStakeholder, {});

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={stakeholder.id} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-xs"
        disabled={isPending}
        title={`Remove ${stakeholder.name}`}
      >
        {isPending ? (
          <Loader2Icon className="size-3 animate-spin" />
        ) : (
          <XIcon className="size-3" />
        )}
      </Button>
      {state.success === false && (
        <span className="ml-1 text-xs text-destructive">{state.message}</span>
      )}
    </form>
  );
}

export function ShowStakeholderManager({
  wpShowId,
  showName,
  stakeholders,
}: ShowStakeholderManagerProps) {
  const [state, formAction, isPending] = useActionState(addStakeholder, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <div className="space-y-4">
      {/* Existing stakeholders */}
      {stakeholders.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Notification recipients
          </p>
          <ul className="space-y-1">
            {stakeholders.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-md border bg-gray-50 px-3 py-1.5 text-sm dark:bg-gray-900"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground">{s.email}</span>
                <span className="ml-auto">
                  <RemoveStakeholderButton stakeholder={s} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No stakeholders configured. Add email addresses to receive
          notifications when content is published for this show.
        </p>
      )}

      {/* Add stakeholder form */}
      <form ref={formRef} action={formAction} className="space-y-3">
        <input type="hidden" name="wp_show_id" value={wpShowId} />

        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <Label htmlFor={`name-${wpShowId}`}>Name</Label>
            <Input
              id={`name-${wpShowId}`}
              name="name"
              placeholder="Stakeholder name"
              required
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor={`email-${wpShowId}`}>Email</Label>
            <Input
              id={`email-${wpShowId}`}
              name="email"
              type="email"
              placeholder="email@example.com"
              required
            />
          </div>
          <Button type="submit" disabled={isPending} size="default">
            {isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              "Add"
            )}
          </Button>
        </div>

        {state.message && (
          <p
            className={`text-sm ${
              state.success
                ? "text-green-700 dark:text-green-400"
                : "text-destructive"
            }`}
          >
            {state.message}
          </p>
        )}
      </form>
    </div>
  );
}
