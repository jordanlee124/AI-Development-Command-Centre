"use server";

import { createMilestone, updateMilestone } from "@/server/services/milestone-service";
import { addComment, createTask, moveTask, updateTask } from "@/server/services/task-service";
import { formObject, mutate, type ActionState } from "./mutate";

const LISTS = ["dependsOnIds"];

export async function createTaskAction(_: ActionState, formData: FormData) {
  return mutate(() => createTask(formObject(formData, LISTS)));
}

export async function updateTaskAction(_: ActionState, formData: FormData) {
  return mutate(() => updateTask(formObject(formData, LISTS)));
}

export async function moveTaskAction(id: string, status: string) {
  return mutate(() => moveTask({ id, status }));
}

export async function addCommentAction(_: ActionState, formData: FormData) {
  return mutate(() => addComment(formObject(formData)));
}

export async function saveMilestoneAction(_: ActionState, formData: FormData) {
  const input = formObject(formData);
  return mutate(() => (input.id ? updateMilestone(input) : createMilestone(input)));
}
