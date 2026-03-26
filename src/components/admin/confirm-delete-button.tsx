"use client";

import { Button } from "@/components/ui/button";

export function ConfirmDeleteButton({
  action,
  userId,
}: {
  action: (formData: FormData) => Promise<void>;
  userId: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Are you sure you want to permanently delete this user? This cannot be undone."
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" variant="destructive">
        Delete User
      </Button>
    </form>
  );
}
