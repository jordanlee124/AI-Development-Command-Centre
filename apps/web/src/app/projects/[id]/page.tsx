import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Archive, CalendarCheck, ListTodo, Milestone } from "lucide-react";
import { DataUnavailable } from "@/components/dashboard/data-unavailable";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { MilestoneStatusBadge, ProjectStatusBadge } from "@/components/dashboard/status-badges";
import { MilestoneFormDialog } from "@/components/projects/milestone-form";
import { ProjectFormDialog } from "@/components/projects/project-form";
import { ProjectLifecycle } from "@/components/projects/project-lifecycle";
import { RepositoryLinks } from "@/components/projects/repository-links";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskFormDialog } from "@/components/tasks/task-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDate, formatDateOnly, formatDateTime, formatRelative } from "@/lib/format";
import { load } from "@/server/services/load";
import { getProjectDetail, type ProjectDetail } from "@/server/services/project-service";

export const metadata: Metadata = { title: "Project" };
export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const result = await load(() => getProjectDetail(id));
  if (result.ok && !result.data) notFound();

  return result.ok && result.data ? (
    <ProjectContent detail={result.data} />
  ) : (
    <>
      <PageHeader title="Project" />
      {!result.ok && <DataUnavailable error={result.error} />}
    </>
  );
}

function ProjectContent({ detail }: { detail: ProjectDetail }) {
  const { project, progress, milestones, board, taskOptions, activity } = detail;
  const readOnly = project.archivedAt !== null;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground">
          Projects
        </Link>{" "}
        / <span aria-current="page">{project.name}</span>
      </nav>
      <PageHeader title={project.name} description={project.description ?? undefined}>
        <div className="flex flex-wrap items-start gap-2">
          {!readOnly && (
            <>
              <TaskFormDialog
                projectId={project.id}
                milestones={milestones}
                taskOptions={taskOptions}
              />
              <ProjectFormDialog project={project} />
            </>
          )}
          <ProjectLifecycle project={project} counts={project._count} />
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <ProjectStatusBadge status={project.status} />
        {project.archivedAt && (
          <Badge variant="secondary">
            <Archive aria-hidden /> Archived {formatDate(project.archivedAt)}
          </Badge>
        )}
        <span>
          Folder:{" "}
          {project.localPath ? (
            <code className="font-mono text-foreground">{project.localPath}</code>
          ) : (
            "not set"
          )}
        </span>
      </div>
      {readOnly && (
        <p role="status" className="rounded-md border border-dashed p-3 text-sm">
          This project is archived, so it is read-only. Unarchive it to make changes, or delete it
          permanently.
        </p>
      )}

      <section aria-label="Project metrics" className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Completion"
          value={progress.percent === null ? null : `${progress.percent}%`}
          hint={
            progress.total === 0
              ? "No tasks yet"
              : `${progress.done} of ${progress.total} tasks completed`
          }
          icon={CalendarCheck}
        />
        <StatCard
          label="Tasks"
          value={project._count.tasks}
          hint="Including cancelled"
          icon={ListTodo}
        />
        <StatCard
          label="Milestones"
          value={milestones.length}
          hint={`${milestones.filter((m) => m.status === "COMPLETED").length} completed`}
          icon={Milestone}
        />
      </section>

      <section aria-labelledby="board-heading" className="flex flex-col gap-2">
        <h2 id="board-heading" className="text-lg font-semibold">
          Board
        </h2>
        {board.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title="No tasks on the board"
            description={
              readOnly
                ? "This archived project has no open tasks."
                : "Create a task to start tracking work. Cancelled tasks are listed on the Tasks page."
            }
          />
        ) : (
          <TaskBoard tasks={board} readOnly={readOnly} />
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Milestones</h2>
            </CardTitle>
            {!readOnly && (
              <CardAction>
                <MilestoneFormDialog projectId={project.id} />
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {milestones.length === 0 ? (
              <p className="text-sm text-muted-foreground">No milestones yet.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {milestones.map((milestone) => (
                  <li key={milestone.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{milestone.title}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        <MilestoneStatusBadge status={milestone.status} />
                        {!readOnly && (
                          <MilestoneFormDialog projectId={project.id} milestone={milestone} />
                        )}
                      </span>
                    </div>
                    <Progress
                      value={milestone.percent ?? 0}
                      aria-label={`${milestone.title} completion`}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {milestone.percent === null
                          ? "No tasks"
                          : `${milestone.percent}% · ${milestone.done}/${milestone.total} tasks`}
                      </span>
                      <span>
                        {milestone.dueDate
                          ? `Due ${formatDateOnly(milestone.dueDate)}`
                          : "No due date"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Repositories</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RepositoryLinks
              projectId={project.id}
              repositories={project.repositories}
              readOnly={readOnly}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Recent activity</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No activity yet"
                description="Changes to this project and its tasks appear here."
                className="border-0 p-0"
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {activity.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="block">{event.title}</span>
                      {event.description && (
                        <span className="text-xs text-muted-foreground">{event.description}</span>
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
      </div>
    </>
  );
}
