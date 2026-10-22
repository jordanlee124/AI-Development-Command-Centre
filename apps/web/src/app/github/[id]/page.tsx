import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { refreshRepositoryAction } from "@/app/actions/github";
import { ActionButton } from "@/components/dashboard/action-button";
import { DataUnavailable } from "@/components/dashboard/data-unavailable";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  IssueStateBadge,
  NotAvailable,
  PullRequestStateBadge,
  ReviewStatusBadge,
  RunStatusBadge,
  SyncStatusBadge,
} from "@/components/github/github-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatRelative } from "@/lib/format";
import {
  getGitHubRepository,
  getGitHubSettings,
  type GitHubRepositoryDetail,
} from "@/server/services/github-service";
import { load } from "@/server/services/load";

export const metadata: Metadata = { title: "Repository" };
export const dynamic = "force-dynamic";

export default async function RepositoryPage({ params }: PageProps<"/github/[id]">) {
  const { id } = await params;
  const result = await load(() => getGitHubRepository(id));
  if (result.ok && !result.data) notFound();

  return result.ok && result.data ? (
    <RepositoryContent detail={result.data} configured={getGitHubSettings().configured} />
  ) : (
    <>
      <PageHeader title="Repository" />
      {!result.ok && <DataUnavailable error={result.error} />}
    </>
  );
}

function When({ date }: { date: Date }) {
  return (
    <time dateTime={date.toISOString()} title={formatDateTime(date)}>
      {formatRelative(date)}
    </time>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="pb-0">
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      {children}
    </Card>
  );
}

function None({ children }: { children: React.ReactNode }) {
  return <CardContent className="pb-6 text-sm text-muted-foreground">{children}</CardContent>;
}

function RepositoryContent({
  detail,
  configured,
}: {
  detail: GitHubRepositoryDetail;
  configured: boolean;
}) {
  const { repository: repo, activity } = detail;
  const fullName = `${repo.owner}/${repo.name}`;
  const synced = repo.lastSyncedAt !== null;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/github" className="hover:text-foreground">
          GitHub
        </Link>{" "}
        / <span aria-current="page">{fullName}</span>
      </nav>
      <PageHeader title={fullName} description={repo.description ?? undefined}>
        {configured && (
          <ActionButton variant="outline" action={refreshRepositoryAction.bind(null, repo.id)}>
            <RefreshCw aria-hidden />
            Refresh
          </ActionButton>
        )}
      </PageHeader>

      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Project</dt>
          <dd>
            {repo.project ? (
              <Link href={`/projects/${repo.project.id}`} className="hover:underline">
                {repo.project.name}
              </Link>
            ) : (
              "Unlinked"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sync</dt>
          <dd>
            <SyncStatusBadge lastSyncedAt={repo.lastSyncedAt} lastSyncError={repo.lastSyncError} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last successful sync</dt>
          <dd>{repo.lastSyncedAt ? formatDateTime(repo.lastSyncedAt) : "Never"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last attempt</dt>
          <dd>{repo.lastSyncAttemptAt ? formatDateTime(repo.lastSyncAttemptAt) : "Never"}</dd>
        </div>
        {repo.htmlUrl && (
          <div>
            <dt className="text-muted-foreground">On GitHub</dt>
            <dd>
              <a href={repo.htmlUrl} className="hover:underline">
                {repo.isPrivate ? "Private" : "Public"} repository
              </a>
            </dd>
          </div>
        )}
      </dl>

      {repo.lastSyncError && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          Last sync failed
          {repo.syncFailures > 1 ? ` (${repo.syncFailures} attempts in a row)` : ""}:{" "}
          {repo.lastSyncError}
          {synced && " Showing data from the last successful sync."}
        </p>
      )}

      {!synced ? (
        <EmptyState
          icon={RefreshCw}
          title="Not synced yet"
          description={
            configured
              ? "Nothing has been read from GitHub for this repository. Refresh to sync it now."
              : "Connect GitHub on the GitHub page to sync this repository."
          }
        />
      ) : (
        <>
          <Section title="Pull requests">
            {repo.pullRequests.length === 0 ? (
              <None>No open pull requests and none closed recently.</None>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Pull request</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Reviews</TableHead>
                    <TableHead>Author</TableHead>
                    <TableHead className="pr-6 text-right">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repo.pullRequests.map((pr) => (
                    <TableRow key={pr.number}>
                      <TableCell className="max-w-md pl-6">
                        <a href={pr.url} className="block truncate hover:underline">
                          #{pr.number} {pr.title}
                        </a>
                        <span className="font-mono text-xs text-muted-foreground">
                          {pr.headRef} → {pr.baseRef}
                        </span>
                      </TableCell>
                      <TableCell>
                        <PullRequestStateBadge state={pr.state} draft={pr.draft} />
                      </TableCell>
                      <TableCell>
                        <ReviewStatusBadge status={pr.reviewStatus} />
                        {pr.approvals !== null &&
                          (pr.approvals > 0 || (pr.changesRequested ?? 0) > 0) && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {pr.approvals} approved · {pr.changesRequested} changes
                            </span>
                          )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {pr.authorLogin ?? "ghost"}
                      </TableCell>
                      <TableCell className="pr-6 text-right text-muted-foreground">
                        <When date={pr.githubUpdatedAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          <Section title="Workflow runs">
            {repo.workflowRuns.length === 0 ? (
              <None>No GitHub Actions runs.</None>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead className="pr-6 text-right">Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repo.workflowRuns.map((run) => (
                    <TableRow key={run.githubId.toString()}>
                      <TableCell className="max-w-md pl-6">
                        <a href={run.url} className="block truncate hover:underline">
                          {run.name ?? run.title} #{run.runNumber}
                        </a>
                        <span className="block truncate text-xs text-muted-foreground">
                          {run.title}
                        </span>
                      </TableCell>
                      <TableCell>
                        <RunStatusBadge status={run.status} conclusion={run.conclusion} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {run.branch ?? <NotAvailable />}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{run.event}</TableCell>
                      <TableCell className="pr-6 text-right text-muted-foreground">
                        <When date={run.githubCreatedAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section
              title={`Recent commits${repo.defaultBranch ? ` on ${repo.defaultBranch}` : ""}`}
            >
              {repo.commits.length === 0 ? (
                <None>No commits (the repository is empty).</None>
              ) : (
                <CardContent className="pb-6">
                  <ul className="flex flex-col gap-3 text-sm">
                    {repo.commits.map((commit) => (
                      <li key={commit.sha} className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <a href={commit.url} className="block truncate hover:underline">
                            {commit.message}
                          </a>
                          <span className="text-xs text-muted-foreground">
                            <span className="font-mono">{commit.sha.slice(0, 7)}</span> ·{" "}
                            {commit.authorLogin ?? commit.authorName}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          <When date={commit.committedAt} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
            </Section>

            <Section title="Activity">
              {activity.length === 0 ? (
                <None>No activity recorded for this repository.</None>
              ) : (
                <CardContent className="pb-6">
                  <ol className="flex flex-col gap-3 text-sm">
                    {activity.map((event) => (
                      <li key={event.id} className="flex items-start justify-between gap-3">
                        <span className="min-w-0 truncate">{event.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          <When date={event.occurredAt} />
                        </span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              )}
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Issues">
              {repo.issues.length === 0 ? (
                <None>
                  No issues among the 30 most recently updated issues and pull requests, or issues
                  are turned off for this repository.
                </None>
              ) : (
                <CardContent className="pb-6">
                  <ul className="flex flex-col gap-3 text-sm">
                    {repo.issues.map((issue) => (
                      <li key={issue.number} className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <a href={issue.url} className="block truncate hover:underline">
                            #{issue.number} {issue.title}
                          </a>
                          <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                            <IssueStateBadge state={issue.state} />
                            {issue.labels.map((label) => (
                              <Badge key={label} variant="secondary">
                                {label}
                              </Badge>
                            ))}
                            {issue.comments > 0 && <span>{issue.comments} comments</span>}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          <When date={issue.githubUpdatedAt} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
            </Section>

            <Section title="Branches">
              {repo.branches.length === 0 ? (
                <None>No branches.</None>
              ) : (
                <CardContent className="pb-6">
                  <ul className="flex flex-col gap-2 text-sm">
                    {repo.branches.map((branch) => (
                      <li key={branch.name} className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono">{branch.name}</span>
                          {branch.name === repo.defaultBranch && (
                            <Badge variant="secondary">default</Badge>
                          )}
                          {branch.protected && <Badge variant="outline">protected</Badge>}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {branch.headSha.slice(0, 7)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
            </Section>
          </div>
        </>
      )}
    </>
  );
}
