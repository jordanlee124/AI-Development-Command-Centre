import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Bot, ChartColumn, FolderKanban, GitBranch, ListTodo } from "lucide-react";
import { AGENT_SOURCE_LABELS, totalTokens } from "@/domain/agent";
import { DataUnavailable } from "@/components/dashboard/data-unavailable";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatCompact, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { getOverview, USAGE_WINDOW_DAYS, type Overview } from "@/server/services/dashboard-service";
import { load } from "@/server/services/load";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const result = await load(() => getOverview());

  return (
    <>
      <PageHeader title="Overview" description="Your local development at a glance." />
      {result.ok ? (
        <OverviewContent overview={result.data} />
      ) : (
        <DataUnavailable error={result.error} />
      )}
    </>
  );
}

function OverviewContent({ overview }: { overview: Overview }) {
  const { agents, usage, github } = overview;
  const hasAgents = agents.sessionCount > 0;

  return (
    <>
      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total projects"
          value={formatNumber(overview.projectCount)}
          hint="Not archived"
          icon={FolderKanban}
        />
        <StatCard
          label="Active tasks"
          value={formatNumber(overview.activeTasks)}
          hint={`To do, in progress or in review · ${formatNumber(overview.totalTasks)} total`}
          icon={ListTodo}
        />
        <StatCard
          label="Agents active · 24 h"
          value={hasAgents ? agents.activeSources.length : null}
          hint={
            hasAgents
              ? "Agent tools with session events in the last 24 h"
              : "No agent sessions recorded"
          }
          icon={Bot}
        />
        <StatCard
          label={`Tokens · ${USAGE_WINDOW_DAYS} days`}
          value={usage ? formatCompact(totalTokens(usage.totals)) : null}
          hint={usage ? `${formatNumber(usage.records)} usage records` : "No usage recorded"}
          icon={ChartColumn}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Project completion</h2>
            </CardTitle>
            <CardAction>
              <Link
                href="/projects"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                All projects
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {overview.projectCompletion.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                description="Create a project on the Projects page to track its tasks here."
                className="border-0"
              />
            ) : (
              <ul className="flex flex-col gap-4">
                {overview.projectCompletion.map((project) => (
                  <li key={project.id} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <Link
                        href={`/projects/${project.id}`}
                        className="truncate font-medium hover:underline"
                      >
                        {project.name}
                      </Link>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {project.percent === null
                          ? "No tasks"
                          : `${project.percent}% · ${project.done}/${project.total}`}
                      </span>
                    </div>
                    <Progress
                      value={project.percent ?? 0}
                      aria-label={`${project.name} completion`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Recent activity</h2>
            </CardTitle>
            <CardAction>
              <Link
                href="/activity"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                View all
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {overview.recentActivity.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No activity yet"
                description="Events appear here once projects, GitHub and agent sessions are connected."
                className="border-0"
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {overview.recentActivity.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate">{event.title}</span>
                      {event.project && (
                        <span className="text-xs text-muted-foreground">{event.project.name}</span>
                      )}
                    </span>
                    <time
                      dateTime={event.occurredAt.toISOString()}
                      title={formatDateTime(event.occurredAt)}
                      className="shrink-0 text-xs text-muted-foreground"
                    >
                      {formatRelative(event.occurredAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Usage summary</h2>
            </CardTitle>
            <CardAction>
              <Link
                href="/analytics"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Analytics
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {usage === null ? (
              <EmptyState
                icon={ChartColumn}
                title="No usage data"
                description="Token usage is read from Claude Code and Codex sessions once the Agent Bridge is set up (Phase 5)."
                className="border-0"
              />
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <UsageFigure label="Input tokens" value={usage.totals.inputTokens} />
                <UsageFigure label="Output tokens" value={usage.totals.outputTokens} />
                <UsageFigure label="Cache read" value={usage.totals.cacheReadTokens} />
                <UsageFigure label="Cache write" value={usage.totals.cacheWriteTokens} />
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Most tokens</dt>
                  <dd className="font-medium">{usage.byModel[0]?.model}</dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>GitHub summary</h2>
            </CardTitle>
            <CardAction>
              <Link href="/github" className="text-sm text-muted-foreground hover:text-foreground">
                Repositories
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {github.total === 0 ? (
              <EmptyState
                icon={GitBranch}
                title="GitHub not connected"
                description="Connect GitHub and link repositories on the GitHub page."
                className="border-0"
              />
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Repositories</dt>
                  <dd className="text-xl font-semibold tabular-nums">{github.total}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Linked to projects</dt>
                  <dd className="text-xl font-semibold tabular-nums">{github.linked}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Last sync</dt>
                  <dd>{github.lastSyncedAt ? formatDateTime(github.lastSyncedAt) : "Never"}</dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      {hasAgents && (
        <p className="text-xs text-muted-foreground">
          Agent sources seen in the last 24 h:{" "}
          {agents.activeSources.map((source) => AGENT_SOURCE_LABELS[source]).join(", ") || "none"}.
        </p>
      )}
    </>
  );
}

function UsageFigure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums" title={formatNumber(value)}>
        {formatCompact(value)}
      </dd>
    </div>
  );
}
