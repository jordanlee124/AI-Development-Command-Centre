"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { MoveHorizontal } from "lucide-react";
import { moveTaskAction } from "@/app/actions/tasks";
import { BOARD_STATUSES, TASK_STATUS_LABELS, type TaskStatus } from "@/domain/task";
import type { ProjectDetail } from "@/server/services/project-service";
import { AgentBadge, BlockedBadge, TaskPriorityBadge } from "@/components/dashboard/status-badges";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";

type BoardTask = ProjectDetail["board"][number];

const DRAG_TYPE = "application/x-adcc-task";

/**
 * Kanban board. Drag a card to another column, or use its "Move" menu (keyboard and touch).
 * Moves show at once and roll back if the server refuses them, e.g. a blocked task.
 */
export function TaskBoard({ tasks, readOnly }: { tasks: BoardTask[]; readOnly: boolean }) {
  const [optimisticTasks, applyMove] = useOptimistic(
    tasks,
    (current, move: { id: string; status: TaskStatus }) =>
      current.map((task) => (task.id === move.id ? { ...task, status: move.status } : task)),
  );
  const [, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);

  const move = (task: BoardTask, status: TaskStatus) => {
    if (readOnly || task.status === status) return;
    startTransition(async () => {
      applyMove({ id: task.id, status });
      const result = await moveTaskAction(task.id, status);
      setMessage(
        result?.ok
          ? { text: `Moved ${task.title} to ${TASK_STATUS_LABELS[status]}.`, error: false }
          : { text: `Couldn't move ${task.title}. ${result?.error ?? ""}`, error: true },
      );
    });
  };

  const dropOn = (status: TaskStatus, event: React.DragEvent) => {
    event.preventDefault();
    setDropTarget(null);
    const task = optimisticTasks.find((t) => t.id === event.dataTransfer.getData(DRAG_TYPE));
    if (task) move(task, status);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Two fixed live regions: screen readers may ignore a region whose role changes. */}
      <div className="min-h-5 text-sm">
        <p role="status" className="text-muted-foreground">
          {message && !message.error ? message.text : ""}
        </p>
        <p role="alert" className="text-destructive">
          {message?.error ? message.text : ""}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {BOARD_STATUSES.map((status) => {
          const column = optimisticTasks.filter((task) => task.status === status);
          return (
            <section
              key={status}
              aria-labelledby={`column-${status}`}
              data-column={status}
              onDragOver={(event) => {
                if (readOnly || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
                event.preventDefault();
                setDropTarget(status);
              }}
              onDragLeave={() => setDropTarget((t) => (t === status ? null : t))}
              onDrop={(event) => dropOn(status, event)}
              className={cn(
                "flex min-h-32 flex-col gap-2 rounded-lg border bg-muted/40 p-2 transition-colors",
                dropTarget === status && "border-primary bg-accent",
              )}
            >
              <h3
                id={`column-${status}`}
                className="flex items-center justify-between px-1 text-sm font-medium"
              >
                {TASK_STATUS_LABELS[status]}
                <span className="text-xs text-muted-foreground tabular-nums">{column.length}</span>
              </h3>
              <ul className="flex flex-col gap-2">
                {column.map((task) => (
                  <TaskCard key={task.id} task={task} readOnly={readOnly} onMove={move} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  readOnly,
  onMove,
}: {
  task: BoardTask;
  readOnly: boolean;
  onMove: (task: BoardTask, status: TaskStatus) => void;
}) {
  return (
    <li
      draggable={!readOnly}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, task.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      data-task-id={task.id}
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-card p-2.5 text-sm shadow-xs",
        !readOnly && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <Link href={`/tasks/${task.id}`} className="font-medium hover:underline">
          {task.title}
        </Link>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${task.title}`}
                  className="shrink-0"
                />
              }
            >
              <MoveHorizontal aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={task.status}
                  onValueChange={(status: TaskStatus) => onMove(task, status)}
                >
                  {BOARD_STATUSES.map((status) => (
                    <DropdownMenuRadioItem key={status} value={status}>
                      {TASK_STATUS_LABELS[status]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <TaskPriorityBadge priority={task.priority} />
        {task.blocked && <BlockedBadge />}
        {task.assignedAgent && <AgentBadge agent={task.assignedAgent} />}
      </div>
      {(task.dueDate || task.milestone) && (
        <div className="text-xs text-muted-foreground">
          {[task.dueDate && `Due ${formatDateOnly(task.dueDate)}`, task.milestone?.title]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
    </li>
  );
}
