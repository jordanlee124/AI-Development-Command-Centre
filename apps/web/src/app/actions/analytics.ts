"use server";

import { deletePrice, saveAnalyticsSettings, savePrice } from "@/server/services/analytics-service";
import { formObject, mutate, type ActionState } from "./mutate";

export async function savePriceAction(_: ActionState, formData: FormData) {
  return mutate(() => savePrice(formObject(formData)));
}

export async function deletePriceAction(id: string) {
  return mutate(() => deletePrice(id));
}

export async function saveAnalyticsSettingsAction(_: ActionState, formData: FormData) {
  return mutate(() => saveAnalyticsSettings(formObject(formData)));
}
