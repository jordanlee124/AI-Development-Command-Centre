import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Bot, TriangleAlert } from "lucide-react";
import { z } from "zod";
import {
  AGENT_SOURCE_LABELS,
  AGENT_SOURCES,
  PROVIDER_CAPABILITIES,
  totalTokens,
  type AgentSource,
} from "@/domain/agent";
import { BridgeStatusCard, SessionStateBadge, When } from "@/components/agents/agent-status";
import { RefreshButton } from "@/components/agents/refresh-button";
import { DataUnavailable } from "@/components/dashboard/data-unavailable";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { AgentBadge } from "@/components/dashboard/status-badges";
import { NotAvailable } from "@/components/github/github-badges";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCompact, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getAgentsOverview, type AgentsOverview } from "@/server/services/agent-service";
import { load } from "@/server/services/load";

export const metadata: Metadata = { title: "AI Agents" };
export const dynamic = "force-dynamic";

// An unknown value falls back to "all tools" rather than an error.
const filterSchema = z.object({ source: z.enum(AGENT_SOURCES).optional().catch(undefined) });

export default async function AgentsPage({ searchParams }: PageProps<"/agents">) {
  const { source } = filterSchema.parse(await searchParams);
  const result = await load(() => getAgentsOverview(source));

  return (
    <>
      <PageHeader
        title="AI Agents"
        description="Claude Code and Codex sessions on this machine, read by the Agent Bridge. Monitoring only: nothing here runs or controls an agent."
      >
        <RefreshButton />
      </PageHeader>
      {!result.ok ? (
        <DataUnavailable error={result.error} />
      ) : (
        <Overview data={result.data} source={source} />
      )}
    </>
  );
}

function SourceFilter({ source, counts }: { source?: AgentSource; counts: Map<string, number> }) {
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  return (
    <nav aria-label="Filter by tool" className="flex flex-wrap gap-1">
      {([undefined, ...AGENT_SOURCES] as const).map((value) => (
        <Link
          key={value ?? "all"}
          href={value ? `/agents?source=${value}` : "/agents"}
          aria-current={value === source ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            value === source && "bg-accent font-medium text-foreground",
          )}
        >
          {value ? AGENT_SOURCE_LABELS[value] : "All"}{" "}
          <span className="text-xs tabular-nums">{value ? (counts.get(value) ?? 0) : total}</span>
        </Link>
      ))}
    </nav>
  );
}

function Overview({
  data: { bridge, sessions, counts },
  source,
}: {
  data: AgentsOverview;
  source?: AgentSource;
}) {
  // Only Claude Code has a live check; for Codex alone the count is unknown, not zero.
  const liveSupported = !source || PROVIDER_CAPABILITIES[source].liveStatus !== null;
  const live = bridge.live.ok && liveSupported ? bridge.live.sessions.length : null;
  const errors = sessions.reduce((sum, s) => sum + s.errors, 0);
  const label = source ? `${AGENT_SOURCE_LABELS[source]} session` : "agent session";

  return (
    <>
      <BridgeStatusCard bridge={bridge} />
      <SourceFilter source={source} counts={counts} />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Sessions"
          value={formatNumber(sessions.length)}
          hint={
            sessions.length === 200 ? "The 200 most recently active" : "Recorded on this machine"
          }
          icon={Bot}
        />
        <StatCard
          label="Running now"
          value={live}
          hint={
            source && !liveSupported
              ? `${AGENT_SOURCE_LABELS[source]} has no supported live session check`
              : bridge.live.ok
                ? "Claude Code, per claude agents --json"
                : bridge.live.reason
          }
          icon={Activity}
        />
        <StatCard
          label="Errors"
          value={formatNumber(errors)}
          hint="Tool and API errors in these sessions"
          icon={TriangleAlert}
        />
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          icon={Bot}
          title={`No ${label}s`}
          description={`No ${label} has been received from the Agent Bridge yet. Sessions appear once the bridge reads a session file from an approved folder.`}
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Tool</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead className="text-right">Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="max-w-80">
                    <Link
                      href={`/agents/${session.id}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {session.title ?? session.externalId}
                    </Link>
                    {session.cwd && (
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {session.cwd}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <AgentBadge agent={session.source} />
                  </TableCell>
                  <TableCell>
                    <SessionStateBadge state={session.state} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {session.models[0] ?? <NotAvailable />}
                    {session.models.length > 1 && (
                      <span className="block text-muted-foreground">
                        +{session.models.length - 1} more
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {session.project ? (
                      <Link href={`/projects/${session.project.id}`} className="hover:underline">
                        {session.project.name}
                      </Link>
                    ) : (
                      "Unassigned"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {session.tokens ? (
                      <span title={formatNumber(totalTokens(session.tokens))}>
                        {formatCompact(totalTokens(session.tokens))}
                      </span>
                    ) : (
                      <NotAvailable />
                    )}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${session.errors > 0 ? "text-destructive" : ""}`}
                  >
                    {formatNumber(session.errors)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {session.lastEventAt ? <When date={session.lastEventAt} /> : <NotAvailable />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
