"use server";

import { redirect } from "next/navigation";
import {
  createProject,
  deleteProject,
  linkRepository,
  setProjectArchived,
  unlinkRepository,
  updateProject,
} from "@/server/services/project-service";
import { formObject, mutate, type ActionState } from "./mutate";

export async function createProjectAction(_: ActionState, formData: FormData) {
  let id: string | undefined;
  const state = await mutate(async () => {
    id = (await createProject(formObject(formData))).id;
  });
  // redirect() throws, so it must run outside mutate's try/catch.
  if (state?.ok && id) redirect(`/projects/${id}`);
  return state;
}

export async function updateProjectAction(_: ActionState, formData: FormData) {
  return mutate(() => updateProject(formObject(formData)));
}

export async function archiveProjectAction(id: string, archived: boolean) {
  return mutate(() => setProjectArchived(id, archived));
}

export async function deleteProjectAction(_: ActionState, formData: FormData) {
  const state = await mutate(() => deleteProject(formObject(formData)));
  if (state?.ok) redirect("/projects");
  return state;
}

export async function linkRepositoryAction(_: ActionState, formData: FormData) {
  return mutate(() => linkRepository(formObject(formData)));
}

export async function unlinkRepositoryAction(projectId: string, repositoryId: string) {
  return mutate(() => unlinkRepository({ projectId, repositoryId }));
}
