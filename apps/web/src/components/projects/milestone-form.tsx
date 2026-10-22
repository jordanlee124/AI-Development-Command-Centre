"use client";

import { Pencil, Plus } from "lucide-react";
import { saveMilestoneAction } from "@/app/actions/tasks";
import { MILESTONE_STATUS_LABELS, type MilestoneStatus } from "@/domain/milestone";
import { toDateInput } from "@/domain/validation";
import { FormDialog } from "@/components/dashboard/form-dialog";
import { SelectField, TextareaField, TextField } from "@/components/dashboard/form-fields";
import { optionsFrom } from "@/lib/options";
import { Button } from "@/components/ui/button";

interface EditableMilestone {
  id: string;
  title: string;
  description: string | null;
  status: MilestoneStatus;
  dueDate: Date | null;
}

export function MilestoneFormDialog({
  projectId,
  milestone,
}: {
  projectId: string;
  milestone?: EditableMilestone;
}) {
  return (
    <FormDialog
      trigger={
        milestone ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit milestone ${milestone.title}`}>
            <Pencil aria-hidden />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus aria-hidden /> New milestone
          </Button>
        )
      }
      title={milestone ? "Edit milestone" : "New milestone"}
      action={saveMilestoneAction}
      submitLabel={milestone ? "Save changes" : "Create milestone"}
    >
      {(state) => (
        <>
          {milestone ? (
            <input type="hidden" name="id" value={milestone.id} />
          ) : (
            <input type="hidden" name="projectId" value={projectId} />
          )}
          <TextField
            name="title"
            label="Title"
            state={state}
            defaultValue={milestone?.title}
            required
            maxLength={200}
            autoComplete="off"
          />
          <TextareaField
            name="description"
            label="Description"
            state={state}
            defaultValue={milestone?.description ?? ""}
            maxLength={5000}
            rows={2}
          />
          <SelectField
            name="status"
            label="Status"
            state={state}
            options={optionsFrom(MILESTONE_STATUS_LABELS)}
            defaultValue={milestone?.status ?? "PLANNED"}
          />
          <TextField
            name="dueDate"
            label="Due date"
            type="date"
            state={state}
            defaultValue={toDateInput(milestone?.dueDate ?? null)}
          />
        </>
      )}
    </FormDialog>
  );
}
