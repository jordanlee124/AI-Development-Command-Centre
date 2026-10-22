import { AGENT_SOURCE_LABELS, type AgentSource } from "@/domain/agent";
import { MILESTONE_STATUS_LABELS, type MilestoneStatus } from "@/domain/milestone";
import { PROJECT_STATUS_LABELS, type ProjectStatus } from "@/domain/project";
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from "@/domain/task";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusTone: Record<TaskStatus, string> = {
  BACKLOG: "text-muted-foreground",
  TODO: "",
  IN_PROGRESS: "border-primary/40 text-primary dark:text-ring",
  IN_REVIEW: "border-warning/40 text-warning",
  DONE: "border-success/40 text-success",
  CANCELLED: "text-muted-foreground line-through",
};

const priorityTone: Record<TaskPriority, string> = {
  LOW: "text-muted-foreground",
  MEDIUM: "",
  HIGH: "border-warning/40 text-warning",
  URGENT: "border-destructive/40 text-destructive",
};

const projectTone: Record<ProjectStatus, string> = {
  PLANNING: "text-muted-foreground",
  ACTIVE: "border-primary/40 text-primary dark:text-ring",
  ON_HOLD: "border-warning/40 text-warning",
  COMPLETED: "border-success/40 text-success",
};

const milestoneTone: Record<MilestoneStatus, string> = {
  PLANNED: "text-muted-foreground",
  ACTIVE: "border-primary/40 text-primary dark:text-ring",
  COMPLETED: "border-success/40 text-success",
  CANCELLED: "text-muted-foreground line-through",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge variant="outline" className={cn(statusTone[status])}>
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <Badge variant="outline" className={cn(priorityTone[priority])}>
      {TASK_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

/** Derived from unfinished dependencies (ADR-012), not a stored status. */
export function BlockedBadge() {
  return (
    <Badge variant="outline" className="border-destructive/40 text-destructive">
      Blocked
    </Badge>
  );
}

export function AgentBadge({ agent }: { agent: AgentSource }) {
  return <Badge variant="secondary">{AGENT_SOURCE_LABELS[agent]}</Badge>;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge variant="outline" className={cn(projectTone[status])}>
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  return (
    <Badge variant="outline" className={cn(milestoneTone[status])}>
      {MILESTONE_STATUS_LABELS[status]}
    </Badge>
  );
}
