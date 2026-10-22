"use client";

import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { archiveProjectAction, deleteProjectAction } from "@/app/actions/projects";
import { ActionButton } from "@/components/dashboard/action-button";
import { FormMessage, TextField, useFormAction } from "@/components/dashboard/form-fields";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface Props {
  project: { id: string; name: string; archivedAt: Date | null };
  counts: { tasks: number; milestones: number };
}

/** Archive / unarchive, and permanent delete once archived. */
export function ProjectLifecycle({ project, counts }: Props) {
  if (!project.archivedAt) {
    return (
      <ActionButton
        variant="outline"
        size="sm"
        action={() => archiveProjectAction(project.id, true)}
      >
        <Archive aria-hidden /> Archive
      </ActionButton>
    );
  }
  return (
    <>
      <ActionButton
        variant="outline"
        size="sm"
        action={() => archiveProjectAction(project.id, false)}
      >
        <ArchiveRestore aria-hidden /> Unarchive
      </ActionButton>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button variant="destructive" size="sm">
              <Trash2 aria-hidden /> Delete
            </Button>
          }
        />
        <AlertDialogContent>
          <DeleteForm project={project} counts={counts} />
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DeleteForm({ project, counts }: Props) {
  const { state, pending, formProps } = useFormAction(deleteProjectAction);
  return (
    <form {...formProps} className="flex flex-col gap-4">
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {project.name} permanently?</AlertDialogTitle>
        <AlertDialogDescription>
          This deletes {counts.tasks} task{counts.tasks === 1 ? "" : "s"} (with their comments and
          history links) and {counts.milestones} milestone{counts.milestones === 1 ? "" : "s"}.
          Linked repositories and timeline entries are kept. This can&apos;t be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <input type="hidden" name="id" value={project.id} />
      <TextField
        name="confirmName"
        label={`Type ${project.name} to confirm`}
        state={state}
        autoComplete="off"
        required
      />
      <FormMessage state={state} />
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Deleting…" : "Delete project"}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
