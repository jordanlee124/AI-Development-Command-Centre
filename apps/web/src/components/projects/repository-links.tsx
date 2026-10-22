"use client";

import Link from "next/link";
import { GitBranch, Unlink } from "lucide-react";
import { linkRepositoryAction, unlinkRepositoryAction } from "@/app/actions/projects";
import { ActionButton } from "@/components/dashboard/action-button";
import { FormMessage, TextField, useFormAction } from "@/components/dashboard/form-fields";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

interface Props {
  projectId: string;
  repositories: { id: string; owner: string; name: string; lastSyncedAt: Date | null }[];
  readOnly: boolean;
}

export function RepositoryLinks({ projectId, repositories, readOnly }: Props) {
  const { state, pending, formProps } = useFormAction(linkRepositoryAction, (form) => form.reset());
  return (
    <div className="flex flex-col gap-4">
      {repositories.length === 0 ? (
        <p className="text-sm text-muted-foreground">No repository linked.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {repositories.map((repo) => (
            <li key={repo.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <GitBranch aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <Link
                    href={`/github/${repo.id}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {repo.owner}/{repo.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {repo.lastSyncedAt
                      ? `Synced ${formatDateTime(repo.lastSyncedAt)}`
                      : "Not synced yet"}
                  </span>
                </span>
              </span>
              {!readOnly && (
                <ActionButton
                  variant="ghost"
                  size="sm"
                  aria-label={`Unlink ${repo.owner}/${repo.name}`}
                  action={() => unlinkRepositoryAction(projectId, repo.id)}
                >
                  <Unlink aria-hidden />
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form {...formProps} className="flex flex-col gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <TextField
                name="repository"
                label="Link a GitHub repository"
                state={state}
                placeholder="owner/name"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            <Button type="submit" variant="outline" className="mt-7" disabled={pending}>
              Link
            </Button>
          </div>
          <FormMessage state={state} />
        </form>
      )}
    </div>
  );
}
