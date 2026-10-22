"use client";

import { useActionState, useId, useRef, useTransition } from "react";
import type { ActionState } from "@/app/actions/mutate";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Option } from "@/lib/options";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Submits a form to a server action. Unlike `<form action>`, React does not reset the fields
 * afterwards, so a failed save keeps what the user typed. `onSuccess` gets the form element.
 */
export function useFormAction(action: Action, onSuccess?: (form: HTMLFormElement) => void) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const next = await action(previous, formData);
      if (next?.ok && ref.current) onSuccess?.(ref.current);
      return next;
    },
    null,
  );
  const [, startTransition] = useTransition();
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
  return { state, pending, formProps: { ref, onSubmit } };
}

export function fieldErrors(state: ActionState, name: string) {
  const messages = state && !state.ok ? state.fieldErrors?.[name] : undefined;
  return messages?.map((message) => ({ message }));
}

/** The form-level error, announced to screen readers. */
export function FormMessage({ state }: { state: ActionState }) {
  if (!state || state.ok) return null;
  // Already shown under its field.
  if (Object.values(state.fieldErrors ?? {}).some((messages) => messages?.includes(state.error))) {
    return null;
  }
  return (
    <p role="alert" className="text-sm text-destructive">
      {state.error}
    </p>
  );
}

interface FieldProps {
  name: string;
  label: string;
  state: ActionState;
  description?: string;
}

export function TextField({
  name,
  label,
  state,
  description,
  ...input
}: FieldProps & Omit<React.ComponentProps<typeof Input>, "name">) {
  const id = useId();
  const errors = fieldErrors(state, name);
  return (
    <Field data-invalid={errors ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} name={name} aria-invalid={errors ? true : undefined} {...input} />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={errors} />
    </Field>
  );
}

export function TextareaField({
  name,
  label,
  state,
  description,
  ...textarea
}: FieldProps & Omit<React.ComponentProps<typeof Textarea>, "name">) {
  const id = useId();
  const errors = fieldErrors(state, name);
  return (
    <Field data-invalid={errors ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea id={id} name={name} aria-invalid={errors ? true : undefined} {...textarea} />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={errors} />
    </Field>
  );
}

export function SelectField({
  name,
  label,
  state,
  description,
  options,
  defaultValue,
}: FieldProps & { options: Option[]; defaultValue: string | null }) {
  const id = useId();
  const errors = fieldErrors(state, name);
  return (
    <Field data-invalid={errors ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select name={name} defaultValue={defaultValue} items={options}>
        <SelectTrigger id={id} className="w-full" aria-invalid={errors ? true : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value ?? ""} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={errors} />
    </Field>
  );
}
