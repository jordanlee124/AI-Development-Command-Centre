"use client";

import { addCommentAction } from "@/app/actions/tasks";
import { FormMessage, TextareaField, useFormAction } from "@/components/dashboard/form-fields";
import { Button } from "@/components/ui/button";

export function CommentForm({ taskId }: { taskId: string }) {
  const { state, pending, formProps } = useFormAction(addCommentAction, (form) => form.reset());
  return (
    <form {...formProps} className="flex flex-col gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      <TextareaField
        name="body"
        label="Add a comment"
        state={state}
        rows={3}
        maxLength={10_000}
        required
      />
      <FormMessage state={state} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Posting…" : "Comment"}
        </Button>
      </div>
    </form>
  );
}
