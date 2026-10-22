"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "@/app/actions/mutate";
import { Button } from "@/components/ui/button";

/** A button that runs one server action and shows its error next to it. */
export function ActionButton({
  action,
  children,
  ...button
}: Omit<React.ComponentProps<typeof Button>, "action" | "onClick"> & {
  action: () => Promise<ActionState>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        {...button}
        disabled={pending || button.disabled}
        onClick={() =>
          startTransition(async () => {
            const state = await action();
            setError(state && !state.ok ? state.error : null);
          })
        }
      >
        {children}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
