"use client";

import { useActionState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Loader2Icon, CheckCircle2Icon, AlertCircleIcon } from "lucide-react";

interface FormState {
  success?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
}

interface FormShellProps {
  title: string;
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  submitLabel?: string;
}

export function FormShell({
  title,
  action,
  children,
  className,
  submitLabel = "Submit",
}: FormShellProps) {
  const [state, formAction, isPending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Reset form on success
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <Card className={cn("mx-auto w-full max-w-2xl", className)}>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>

      <form ref={formRef} action={formAction}>
        <CardContent className="space-y-5">
          {/* Success message */}
          {state.success && state.message && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800/50 dark:bg-green-950/30 dark:text-green-300">
              <CheckCircle2Icon className="size-4 shrink-0" />
              {state.message}
            </div>
          )}

          {/* Error message */}
          {state.success === false && state.message && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircleIcon className="size-4 shrink-0" />
              {state.message}
            </div>
          )}

          {/* Field-level errors */}
          {state.errors && Object.keys(state.errors).length > 0 && (
            <div className="space-y-1 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
              {Object.entries(state.errors).map(([field, messages]) =>
                messages.map((msg, i) => (
                  <p key={`${field}-${i}`} className="text-sm text-destructive">
                    <span className="font-medium capitalize">
                      {field.replace(/_/g, " ")}
                    </span>
                    : {msg}
                  </p>
                ))
              )}
            </div>
          )}

          {children}
        </CardContent>

        <CardFooter>
          <Button type="submit" disabled={isPending} size="lg" className="w-full">
            {isPending && <Loader2Icon className="size-4 animate-spin" />}
            {isPending ? "Submitting..." : submitLabel}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
