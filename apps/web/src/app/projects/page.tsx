import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { z } from "zod";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "@/domain/project";
import { pageParam } from "@/domain/validation";
import { DataUnavailable } from "@/components/dashboard/data-unavailable";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SelectField, TextField } from "@/components/dashboard/form-fields";
import { optionsFrom } from "@/lib/options";
import { PageHeader } from "@/components/dashboard/page-header";
import { Pager, PastLastPage } from "@/components/dashboard/pager";
import { ProjectStatusBadge } from "@/components/dashboard/status-badges";
import { ProjectFormDialog } from "@/components/projects/project-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { load } from "@/server/services/load";
import { listProjectsPage } from "@/server/services/project-service";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

// Bad or unknown values fall back to "no filter" rather than an error.
const filterSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(PROJECT_STATUSES).optional().catch(undefined),
  archived: z.literal("1").optional().catch(undefined),
  page: pageParam,
});

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const { page, ...filter } = filterSchema.parse(await searchParams);
  const archived = filter.archived === "1";
  const result = await load(() =>
    listProjectsPage({ q: filter.q || undefined, status: filter.status, archived }, page),
  );
  const filtered = Boolean(filter.q || filter.status);

  return (
    <>
      <PageHeader title="Projects" description="Everything you are building, with task progress.">
        <ProjectFormDialog />
      </PageHeader>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <nav aria-label="Project views" className="flex gap-1">
          {[
            { label: "Active", href: "/projects", current: !archived },
            { label: "Archived", href: "/projects?archived=1", current: archived },
          ].map((view) => (
            <Link
              key={view.label}
              href={view.href}
              aria-current={view.current ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                view.current && "bg-accent font-medium text-foreground",
              )}
            >
              {view.label}
            </Link>
          ))}
        </nav>
        <form role="search" aria-label="Filter projects" className="flex flex-wrap items-end gap-2">
          {archived && <input type="hidden" name="archived" value="1" />}
          <div className="w-56">
            <TextField
              name="q"
              label="Search"
              state={null}
              type="search"
              defaultValue={filter.q}
              placeholder="Name or description"
            />
          </div>
          <div className="w-40">
            <SelectField
              name="status"
              label="Status"
              state={null}
              options={[{ value: null, label: "Any" }, ...optionsFrom(PROJECT_STATUS_LABELS)]}
              defaultValue={filter.status ?? null}
            />
          </div>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
      </div>

      {!result.ok ? (
        <DataUnavailable error={result.error} />
      ) : result.data.projects.length === 0 && result.data.total > 0 ? (
        <PastLastPage
          path="/projects"
          params={{ q: filter.q, status: filter.status, archived: filter.archived }}
        />
      ) : result.data.projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={
            filtered
              ? "No matching projects"
              : archived
                ? "No archived projects"
                : "No projects yet"
          }
          description={
            filtered
              ? "Try a different search or status."
              : archived
                ? "Archived projects appear here. They are read-only until unarchived."
                : "Create a project to start tracking tasks and milestones."
          }
        />
      ) : (
        <>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-48">Completion</TableHead>
                  <TableHead className="text-right">Repositories</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <Link
                        href={`/projects/${project.id}`}
                        className="font-medium hover:underline"
                      >
                        {project.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{project.slug}</div>
                    </TableCell>
                    <TableCell>
                      <ProjectStatusBadge status={project.status} />
                    </TableCell>
                    <TableCell>
                      {project.percent === null ? (
                        <span className="text-sm text-muted-foreground">No tasks</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Progress
                            value={project.percent}
                            aria-label={`${project.name} completion`}
                            className="flex-1"
                          />
                          <span className="w-10 text-right text-xs tabular-nums">
                            {project.percent}%
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {project._count.repositories}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatRelative(project.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Pager
            page={page}
            pageCount={result.data.pageCount}
            path="/projects"
            params={{ q: filter.q, status: filter.status, archived: filter.archived }}
          />
        </>
      )}
    </>
  );
}
