import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AGENT_SOURCE_LABELS } from "@/domain/agent";
import { DataUnavailable } from "@/components/dashboard/data-unavailable";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  AgentBadge,
  BlockedBadge,
  TaskPriorityBadge,
  TaskStatusBadge,
} from "@/components/dashboard/status-badges";
import { CommentForm } from "@/components/tasks/comment-form";
import { TaskFormDialog } from "@/components/tasks/task-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateOnly, formatDateTime, formatRelative } from "@/lib/format";
import { load } from "@/server/services/load";
import { getTaskPage, type TaskPage } from "@/server/services/task-service";

export const metadata: Metadata = { title: "Task" };
export const dynamic = "force-dynamic";

export default async function TaskDetailPage({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  const result = await load(() => getTaskPage(id));
  if (result.ok && !result.data) notFound();

  return result.ok && result.data ? (
    <TaskContent page={result.data} />
  ) : (
    <>
      <PageHeader title="Task" />
      {!result.ok && <DataUnavailable error={result.error} />}
    </>
  );
}

function TaskContent({ page }: { page: TaskPage }) {
  const { task, history, milestones, taskOptions } = page;
  const readOnly = task.project.archivedAt !== null;
  const dependsOn = task.dependencies.map((d) => d.dependsOn);
  const requiredBy = task.dependents.map((d) => d.task);

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground">
          Projects
        </Link>{" "}
        /{" "}
        <Link href={`/projects/${task.project.id}`} className="hover:text-foreground">
          {task.project.name}
        </Link>{" "}
        / <span aria-current="page">{task.title}</span>
      </nav>
      <PageHeader title={task.title}>
        {!readOnly && (
          <TaskFormDialog
            task={{
              ...task,
              milestoneId: task.milestone?.id ?? null,
              dependsOnIds: dependsOn.map((d) => d.id),
            }}
            milestones={milestones}
            taskOptions={taskOptions}
          />
        )}
      </PageHeader>
      <div className="flex flex-wrap items-center gap-1">
        <TaskStatusBadge status={task.status} />
        {task.blocked && <BlockedBadge />}
        <TaskPriorityBadge priority={task.priority} />
        {task.assignedAgent && <AgentBadge agent={task.assignedAgent} />}
      </div>
      {readOnly && (
        <p role="status" className="rounded-md border border-dashed p-3 text-sm">
          This task&apos;s project is archived, so it is read-only.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Description</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {task.description ? (
                <p className="text-sm whitespace-pre-wrap">{task.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No description.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Comments</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {task.comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {task.comments.map((comment) => (
                    <li key={comment.id} className="rounded-md border p-3 text-sm">
                      <time
                        dateTime={comment.createdAt.toISOString()}
                        title={formatDateTime(comment.createdAt)}
                        className="text-xs text-muted-foreground"
                      >
                        {formatRelative(comment.createdAt)}
                      </time>
                      <p className="mt-1 whitespace-pre-wrap">{comment.body}</p>
                    </li>
                  ))}
                </ol>
              )}
              {!readOnly && <CommentForm taskId={task.id} />}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Details</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Milestone</dt>
                <dd>{task.milestone?.title ?? "None"}</dd>
                <dt className="text-muted-foreground">Due</dt>
                <dd>{task.dueDate ? formatDateOnly(task.dueDate) : "No due date"}</dd>
                <dt className="text-muted-foreground">AI provider</dt>
                <dd>{task.assignedAgent ? AGENT_SOURCE_LABELS[task.assignedAgent] : "None"}</dd>
                {task.completedAt && (
                  <>
                    <dt className="text-muted-foreground">Completed</dt>
                    <dd>{formatDateTime(task.completedAt)}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatDateTime(task.createdAt)}</dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Dependencies</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <TaskLinks heading="Depends on" tasks={dependsOn} empty="Nothing." />
              <TaskLinks
                heading="Required by"
                tasks={requiredBy}
                empty="No other task waits on this."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>History</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recorded changes.</p>
              ) : (
                <ol className="flex flex-col gap-3 border-l pl-4">
                  {history.map((event) => (
                    <li key={event.id} className="text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{event.title}</span>
                        <time
                          dateTime={event.occurredAt.toISOString()}
                          title={formatDateTime(event.occurredAt)}
                          className="shrink-0 text-xs text-muted-foreground"
                        >
                          {formatRelative(event.occurredAt)}
                        </time>
                      </div>
                      {event.description && (
                        <p className="text-xs text-muted-foreground">{event.description}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function TaskLinks({
  heading,
  tasks,
  empty,
}: {
  heading: string;
  tasks: TaskPage["task"]["dependencies"][number]["dependsOn"][];
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">{heading}</h3>
      {tasks.length === 0 ? (
        <p className="text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-2">
              <Link href={`/tasks/${task.id}`} className="truncate hover:underline">
                {task.title}
              </Link>
              <TaskStatusBadge status={task.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
