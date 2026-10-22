"use client";

import { linkRepositoryAction } from "@/app/actions/projects";
import { FormMessage, useFormAction } from "@/components/dashboard/form-fields";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Links one accessible GitHub repository to a chosen project (the project service's rules apply). */
export function LinkRepositoryForm({
  repository,
  projects,
}: {
  repository: string;
  projects: { id: string; name: string }[];
}) {
  const { state, pending, formProps } = useFormAction(linkRepositoryAction);
  const items = projects.map((project) => ({ value: project.id, label: project.name }));
  return (
    <form {...formProps} className="flex flex-col items-end gap-1">
      <input type="hidden" name="repository" value={repository} />
      <div className="flex items-center gap-2">
        <Select name="projectId" defaultValue={items[0]?.value ?? null} items={items}>
          <SelectTrigger size="sm" className="w-44" aria-label={`Project for ${repository}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Link
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
