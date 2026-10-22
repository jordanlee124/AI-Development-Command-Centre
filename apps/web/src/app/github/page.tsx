import type { Metadata } from "next";
import Link from "next/link";
import { GitBranch, KeyRound } from "lucide-react";
import { refreshAllRepositoriesAction } from "@/app/actions/github";
import { OPEN_PULLS_LIMIT } from "@/domain/github";
import { ActionButton } from "@/components/dashboard/action-button";
import { DataUnavailable } from "@/components/dashboard/data-unavailable";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { NotAvailable, RunStatusBadge, SyncStatusBadge } from "@/components/github/github-badges";
import { LinkRepositoryForm } from "@/components/github/link-repository-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { getRepositories } from "@/server/services/dashboard-service";
import {
  getAccessibleRepositories,
  getGitHubConnection,
  getGitHubSettings,
} from "@/server/services/github-service";
import { load } from "@/server/services/load";

export const metadata: Metadata = { title: "GitHub" };
export const dynamic = "force-dynamic";

const GITHUB_UNAVAILABLE =
  "GitHub could not be read. The error below says why; repository data already synced is still shown.";

export default async function GitHubPage() {
  const settings = getGitHubSettings();
  const [repos, connection, accessible] = await Promise.all([
    load(getRepositories),
    settings.configured ? load(getGitHubConnection) : null,
    settings.configured ? load(getAccessibleRepositories) : null,
  ]);
  const hasLinked = repos.ok && repos.data.some((repo) => repo.project);

  return (
    <>
      <PageHeader
        title="GitHub"
        description="Read-only view of your repositories. ADCC never changes anything on GitHub."
      >
        {settings.configured && hasLinked && (
          <ActionButton variant="outline" action={refreshAllRepositoriesAction}>
            Sync all now
          </ActionButton>
        )}
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Connection</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {!settings.configured ? (
            <NotConnected />
          ) : !connection?.ok ? (
            <DataUnavailable
              title="GitHub unavailable"
              description={GITHUB_UNAVAILABLE}
              error={connection?.error ?? ""}
            />
          ) : (
            connection.data && (
              <dl className="grid gap-4 sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Account</dt>
                  <dd>
                    <a href={connection.data.viewer.url} className="font-medium hover:underline">
                      @{connection.data.viewer.login}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Token expires</dt>
                  <dd>
                    {connection.data.tokenExpiresAt
                      ? formatDateTime(connection.data.tokenExpiresAt)
                      : "No expiry"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">API requests left</dt>
                  <dd className="tabular-nums">
                    {formatNumber(connection.data.rateLimit.remaining)} of{" "}
                    {formatNumber(connection.data.rateLimit.limit)}, resets{" "}
                    {formatRelative(connection.data.rateLimit.resetAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Background sync</dt>
                  <dd>
                    {settings.syncIntervalMinutes === 0
                      ? "Off"
                      : `Every ${settings.syncIntervalMinutes} minutes`}
                  </dd>
                </div>
              </dl>
            )
          )}
        </CardContent>
      </Card>

      <Card className="pb-0">
        <CardHeader>
          <CardTitle>
            <h2>Repositories</h2>
          </CardTitle>
          <CardDescription>
            Linked to ADCC projects. Background sync keeps repositories of active projects fresh.
          </CardDescription>
        </CardHeader>
        {!repos.ok ? (
          <CardContent className="pb-6">
            <DataUnavailable error={repos.error} />
          </CardContent>
        ) : repos.data.length === 0 ? (
          <CardContent className="pb-6">
            <EmptyState
              icon={GitBranch}
              title="No repositories linked"
              description="Link one from the list below or from a project's page."
            />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Repository</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Open PRs</TableHead>
                <TableHead>Latest CI</TableHead>
                <TableHead>Sync</TableHead>
                <TableHead className="pr-6 text-right">Last successful sync</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repos.data.map((repo) => {
                const run = repo.workflowRuns[0];
                return (
                  <TableRow key={repo.id}>
                    <TableCell className="pl-6 font-mono text-sm">
                      <Link href={`/github/${repo.id}`} className="hover:underline">
                        {repo.owner}/{repo.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {repo.project ? (
                        <Link href={`/projects/${repo.project.id}`} className="hover:underline">
                          {repo.project.name}
                        </Link>
                      ) : (
                        "Unlinked"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/* Unknown until the first sync (ADR-011). */}
                      {!repo.lastSyncedAt ? (
                        <NotAvailable />
                      ) : repo._count.pullRequests >= OPEN_PULLS_LIMIT ? (
                        `${OPEN_PULLS_LIMIT}+`
                      ) : (
                        repo._count.pullRequests
                      )}
                    </TableCell>
                    <TableCell>
                      {run ? (
                        <RunStatusBadge status={run.status} conclusion={run.conclusion} />
                      ) : (
                        <NotAvailable />
                      )}
                    </TableCell>
                    <TableCell>
                      <SyncStatusBadge
                        lastSyncedAt={repo.lastSyncedAt}
                        lastSyncError={repo.lastSyncError}
                      />
                    </TableCell>
                    <TableCell className="pr-6 text-right text-muted-foreground">
                      {repo.lastSyncedAt ? formatDateTime(repo.lastSyncedAt) : "Never"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {accessible && (
        <Card className="pb-0">
          <CardHeader>
            <CardTitle>
              <h2>Accessible on GitHub</h2>
            </CardTitle>
            <CardDescription>
              Repositories your token can read, most recently pushed first (up to 100).
            </CardDescription>
          </CardHeader>
          {!accessible.ok ? (
            <CardContent className="pb-6">
              <DataUnavailable
                title="GitHub unavailable"
                description={GITHUB_UNAVAILABLE}
                error={accessible.error}
              />
            </CardContent>
          ) : accessible.data.repositories.length === 0 ? (
            <CardContent className="pb-6">
              <EmptyState
                icon={GitBranch}
                title="No repositories"
                description="The token can't read any repository. Give it access to the repositories you want in GitHub's token settings."
              />
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Repository</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Last push</TableHead>
                  <TableHead className="pr-6 text-right">ADCC project</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accessible.data.repositories.map((repo) => (
                  <TableRow key={repo.githubId}>
                    <TableCell className="pl-6 font-mono text-sm">
                      <a href={repo.htmlUrl} className="hover:underline">
                        {repo.fullName}
                      </a>
                      {repo.archived && (
                        <Badge variant="outline" className="ml-2 text-muted-foreground">
                          Archived
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {repo.isPrivate ? "Private" : "Public"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {repo.pushedAt ? formatRelative(repo.pushedAt) : "Never"}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      {repo.linkedProject ? (
                        <Link
                          href={`/projects/${repo.linkedProject.id}`}
                          className="text-muted-foreground hover:underline"
                        >
                          {repo.linkedProject.name}
                        </Link>
                      ) : accessible.data.projects.length === 0 ? (
                        <Link
                          href="/projects"
                          className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                        >
                          Create a project to link
                        </Link>
                      ) : (
                        <LinkRepositoryForm
                          repository={repo.fullName}
                          projects={accessible.data.projects}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}

function NotConnected() {
  return (
    <EmptyState
      icon={KeyRound}
      title="GitHub not connected"
      description="ADCC reads GitHub with a fine-grained personal access token that stays on this machine's server and never reaches the browser."
      className="border-0 p-0"
    >
      <ol className="list-decimal space-y-1 pl-5 text-left text-sm text-muted-foreground">
        <li>
          On GitHub, open Settings → Developer settings → Fine-grained tokens and generate a new
          token with an expiry.
        </li>
        <li>
          Choose the repositories, then grant <strong>read-only</strong> access to Metadata,
          Contents, Pull requests, Issues and Actions. Nothing else.
        </li>
        <li>
          Add it to <code>apps/web/.env</code> as <code>GITHUB_TOKEN=github_pat_…</code> and restart
          ADCC.
        </li>
      </ol>
    </EmptyState>
  );
}
