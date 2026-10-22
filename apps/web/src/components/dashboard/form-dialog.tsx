"use client";

import { useState } from "react";
import type { ActionState } from "@/app/actions/mutate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { FormMessage, useFormAction } from "./form-fields";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** A dialog holding one server-action form. Closes on success; reopening starts fresh. */
export function FormDialog({
  trigger,
  title,
  description,
  action,
  submitLabel,
  children,
}: {
  trigger: React.ReactElement;
  title: string;
  description?: string;
  action: Action;
  submitLabel: string;
  children: (state: ActionState) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {/* Mounted only while open, so each opening gets fresh form state. */}
        <DialogForm action={action} submitLabel={submitLabel} onDone={() => setOpen(false)}>
          {children}
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}

function DialogForm({
  action,
  submitLabel,
  onDone,
  children,
}: {
  action: Action;
  submitLabel: string;
  onDone: () => void;
  children: (state: ActionState) => React.ReactNode;
}) {
  const { state, pending, formProps } = useFormAction(action, onDone);
  return (
    <form {...formProps} className="flex flex-col gap-4">
      <FieldGroup>{children(state)}</FieldGroup>
      <FormMessage state={state} />
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
