"use client";

import { useId } from "react";
import { Pencil, Plus } from "lucide-react";
import { createTaskAction, updateTaskAction } from "@/app/actions/tasks";
import { AGENT_SOURCE_LABELS, type AgentSource } from "@/domain/agent";
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from "@/domain/task";
import { toDateInput } from "@/domain/validation";
import { FormDialog } from "@/components/dashboard/form-dialog";
import {
  fieldErrors,
  SelectField,
  TextareaField,
  TextField,
} from "@/components/dashboard/form-fields";
import { optionsFrom, type Option } from "@/lib/options";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import type { ActionState } from "@/app/actions/mutate";

export interface EditableTask {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  milestoneId: string | null;
  assignedAgent: AgentSource | null;
  dependsOnIds: string[];
}

interface Props {
  task?: EditableTask;
  /** The task's project. Omit to let the user pick one (milestone and dependencies are then set later). */
  projectId?: string;
  projects?: { id: string; name: string }[];
  milestones?: { id: string; title: string }[];
  taskOptions?: { id: string; title: string }[];
}

const agentOptions: Option[] = [
  { value: null, label: "None" },
  ...optionsFrom(AGENT_SOURCE_LABELS),
];

export function TaskFormDialog({ task, projectId, projects, milestones, taskOptions }: Props) {
  return (
    <FormDialog
      trigger={
        task ? (
          <Button variant="outline" size="sm">
            <Pencil aria-hidden /> Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus aria-hidden /> New task
          </Button>
        )
      }
      title={task ? "Edit task" : "New task"}
      description="Assigning an AI provider only records who the task is for. Nothing runs it."
      action={task ? updateTaskAction : createTaskAction}
      submitLabel={task ? "Save changes" : "Create task"}
    >
      {(state) => (
        <>
          {task && <input type="hidden" name="id" value={task.id} />}
          {!task && projectId && <input type="hidden" name="projectId" value={projectId} />}
          {!task && !projectId && projects && (
            <SelectField
              name="projectId"
              label="Project"
              state={state}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              defaultValue={projects[0]?.id ?? null}
            />
          )}
          <TextField
            name="title"
            label="Title"
            state={state}
            defaultValue={task?.title}
            required
            maxLength={300}
            autoComplete="off"
          />
          <TextareaField
            name="description"
            label="Description"
            state={state}
            defaultValue={task?.description ?? ""}
            maxLength={20_000}
            rows={4}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="status"
              label="Status"
              state={state}
              options={optionsFrom(TASK_STATUS_LABELS)}
              defaultValue={task?.status ?? "TODO"}
            />
            <SelectField
              name="priority"
              label="Priority"
              state={state}
              options={optionsFrom(TASK_PRIORITY_LABELS)}
              defaultValue={task?.priority ?? "MEDIUM"}
            />
            <TextField
              name="dueDate"
              label="Due date"
              type="date"
              state={state}
              defaultValue={toDateInput(task?.dueDate ?? null)}
            />
            <SelectField
              name="assignedAgent"
              label="AI provider"
              state={state}
              options={agentOptions}
              defaultValue={task?.assignedAgent ?? null}
            />
          </div>
          {milestones && (
            <SelectField
              name="milestoneId"
              label="Milestone"
              state={state}
              options={[
                { value: null, label: "None" },
                ...milestones.map((m) => ({ value: m.id, label: m.title })),
              ]}
              defaultValue={task?.milestoneId ?? null}
            />
          )}
          {taskOptions && taskOptions.length > 0 && (
            <DependencyPicker
              state={state}
              options={taskOptions}
              selected={task?.dependsOnIds ?? []}
            />
          )}
        </>
      )}
    </FormDialog>
  );
}

function DependencyPicker({
  state,
  options,
  selected,
}: {
  state: ActionState;
  options: { id: string; title: string }[];
  selected: string[];
}) {
  const id = useId();
  const errors = fieldErrors(state, "dependsOnIds");
  return (
    <FieldSet data-invalid={errors ? true : undefined}>
      <FieldLegend variant="label">Depends on</FieldLegend>
      <FieldDescription>
        The task can&apos;t move to In progress, In review or Completed until these are completed or
        cancelled.
      </FieldDescription>
      <div className="flex max-h-40 flex-col gap-2 overflow-y-auto rounded-md border p-2">
        {options.map((option) => (
          <Field key={option.id} orientation="horizontal">
            <Checkbox
              id={`${id}-${option.id}`}
              name="dependsOnIds"
              value={option.id}
              defaultChecked={selected.includes(option.id)}
            />
            <FieldLabel htmlFor={`${id}-${option.id}`} className="font-normal">
              {option.title}
            </FieldLabel>
          </Field>
        ))}
      </div>
      <FieldError errors={errors} />
    </FieldSet>
  );
}
