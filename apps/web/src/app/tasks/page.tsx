import type { Metadata } from "next";
import Link from "next/link";
import { ListTodo } from "lucide-react";
import { z } from "zod";
import { AGENT_SOURCES, AGENT_SOURCE_LABELS } from "@/domain/agent";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  countTotal,
} from "@/domain/task";
import { pageParam } from "@/domain/validation";
import { DataUnavailable } from "@/components/dashboard/data-unavailable";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SelectField, TextField } from "@/components/dashboard/form-fields";
import { optionsFrom } from "@/lib/options";
import { PageHeader } from "@/components/dashboard/page-header";
import { Pager, PastLastPage } from "@/components/dashboard/pager";
import {
  AgentBadge,
  BlockedBadge,
  TaskPriorityBadge,
  TaskStatusBadge,
} from "@/components/dashboard/status-badges";
import { TaskFormDialog } from "@/components/tasks/task-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateOnly, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { load } from "@/server/services/load";
import { listTasksPage } from "@/server/services/task-service";

export const metadata: Metadata = { title: "Tasks" };
export const dynamic = "force-dynamic";

// Bad or unknown values fall back to "no filter" rather than an error.
const filterSchema = z.object({
  status: z.enum(TASK_STATUSES).optional().catch(undefined),
  priority: z.enum(TASK_PRIORITIES).optional().catch(undefined),
  project: z.uuid().optional().catch(undefined),
  agent: z.enum(AGENT_SOURCES).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  page: pageParam,
});

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const { page, ...filter } = filterSchema.parse(await searchParams);
  const result = await load(() =>
    listTasksPage(
      {
        status: filter.status,
        priority: filter.priority,
        projectId: filter.project,
        assignedAgent: filter.agent,
        q: filter.q || undefined,
      },
      page,
    ),
  );
  // Keeps the other filters when switching status, and vice versa.
  const params = {
    q: filter.q,
    project: filter.project,
    priority: filter.priority,
    agent: filter.agent,
  };
  const statusHref = (status?: string) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, status }))
      if (value) query.set(key, value);
    const search = query.toString();
    return search ? `/tasks?${search}` : "/tasks";
  };
  const filtered = Object.values(params).some(Boolean);

  return (
    <>
      <PageHeader title="Tasks" description="Work across all projects, newest first.">
        {result.ok && result.data.projects.length > 0 && (
          <TaskFormDialog projects={result.data.projects} />
        )}
      </PageHeader>
      {!result.ok ? (
        <DataUnavailable error={result.error} />
      ) : (
        <>
          <form role="search" aria-label="Filter tasks" className="flex flex-wrap items-end gap-2">
            {filter.status && <input type="hidden" name="status" value={filter.status} />}
            <div className="w-56">
              <TextField
                name="q"
                label="Search"
                state={null}
                type="search"
                defaultValue={filter.q}
                placeholder="Task title"
              />
            </div>
            <div className="w-44">
              <SelectField
                name="project"
                label="Project"
                state={null}
                options={[
                  { value: null, label: "Any" },
                  ...result.data.projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
                defaultValue={filter.project ?? null}
              />
            </div>
            <div className="w-36">
              <SelectField
                name="priority"
                label="Priority"
                state={null}
                options={[{ value: null, label: "Any" }, ...optionsFrom(TASK_PRIORITY_LABELS)]}
                defaultValue={filter.priority ?? null}
              />
            </div>
            <div className="w-40">
              <SelectField
                name="agent"
                label="AI provider"
                state={null}
                options={[{ value: null, label: "Any" }, ...optionsFrom(AGENT_SOURCE_LABELS)]}
                defaultValue={filter.agent ?? null}
              />
            </div>
            <Button type="submit" variant="outline">
              Filter
            </Button>
          </form>

          <nav aria-label="Filter by status" className="flex flex-wrap gap-1">
            {([undefined, ...TASK_STATUSES] as const).map((value) => {
              const active = value === filter.status;
              const count = value
                ? (result.data.counts[value] ?? 0)
                : countTotal(result.data.counts);
              return (
                <Link
                  key={value ?? "all"}
                  href={statusHref(value)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                    active && "bg-accent font-medium text-foreground",
                  )}
                >
                  {value ? TASK_STATUS_LABELS[value] : "All"}{" "}
                  <span className="text-xs tabular-nums">{count}</span>
                </Link>
              );
            })}
          </nav>

          {result.data.tasks.length === 0 && result.data.total > 0 ? (
            <PastLastPage path="/tasks" params={{ ...params, status: filter.status }} />
          ) : result.data.tasks.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title={
                filtered
                  ? "No matching tasks"
                  : filter.status
                    ? `No ${TASK_STATUS_LABELS[filter.status].toLowerCase()} tasks`
                    : "No tasks yet"
              }
              description={
                result.data.projects.length === 0
                  ? "Create a project first; tasks belong to a project."
                  : filtered
                    ? "Try different filters."
                    : "Create a task here or from a project's board."
              }
            />
          ) : (
            <>
              <Card className="py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>AI provider</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.data.tasks.map((task) => (
                      <TableRow key={task.id}>
                        <TableCell>
                          <Link href={`/tasks/${task.id}`} className="font-medium hover:underline">
                            {task.title}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {task.project.name}
                            {task.milestone && ` · ${task.milestone.title}`}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="flex flex-wrap gap-1">
                            <TaskStatusBadge status={task.status} />
                            {task.blocked && <BlockedBadge />}
                          </span>
                        </TableCell>
                        <TableCell>
                          <TaskPriorityBadge priority={task.priority} />
                        </TableCell>
                        <TableCell>
                          {task.assignedAgent ? (
                            <AgentBadge agent={task.assignedAgent} />
                          ) : (
                            <span className="text-muted-foreground">None</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {task.dueDate ? formatDateOnly(task.dueDate) : "—"}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatRelative(task.updatedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
              <Pager
                page={page}
                pageCount={result.data.pageCount}
                path="/tasks"
                params={{ ...params, status: filter.status }}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
