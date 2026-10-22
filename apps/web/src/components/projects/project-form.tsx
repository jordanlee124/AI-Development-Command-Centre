"use client";

import { Pencil, Plus } from "lucide-react";
import { createProjectAction, updateProjectAction } from "@/app/actions/projects";
import { PROJECT_STATUS_LABELS, type ProjectStatus } from "@/domain/project";
import { FormDialog } from "@/components/dashboard/form-dialog";
import { SelectField, TextareaField, TextField } from "@/components/dashboard/form-fields";
import { optionsFrom } from "@/lib/options";
import { Button } from "@/components/ui/button";

interface EditableProject {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  localPath: string | null;
}

export function ProjectFormDialog({ project }: { project?: EditableProject }) {
  return (
    <FormDialog
      trigger={
        project ? (
          <Button variant="outline" size="sm">
            <Pencil aria-hidden /> Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus aria-hidden /> New project
          </Button>
        )
      }
      title={project ? "Edit project" : "New project"}
      action={project ? updateProjectAction : createProjectAction}
      submitLabel={project ? "Save changes" : "Create project"}
    >
      {(state) => (
        <>
          {project && <input type="hidden" name="id" value={project.id} />}
          <TextField
            name="name"
            label="Name"
            state={state}
            defaultValue={project?.name}
            required
            maxLength={200}
            autoComplete="off"
          />
          <TextareaField
            name="description"
            label="Description"
            state={state}
            defaultValue={project?.description ?? ""}
            maxLength={5000}
            rows={3}
          />
          <SelectField
            name="status"
            label="Status"
            state={state}
            options={optionsFrom(PROJECT_STATUS_LABELS)}
            defaultValue={project?.status ?? "ACTIVE"}
          />
          <TextField
            name="localPath"
            label="Local folder"
            state={state}
            defaultValue={project?.localPath ?? ""}
            placeholder="D:\Projects\my-app"
            description="Optional. The project's working folder; agent sessions there will map to this project."
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
          />
        </>
      )}
    </FormDialog>
  );
}
