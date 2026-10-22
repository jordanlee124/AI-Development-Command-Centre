import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AGENT_SOURCE_LABELS,
  PROVIDER_CAPABILITIES,
  isSessionEventType,
  SESSION_EVENT_LABELS,
  totalTokens,
} from "@/domain/agent";
import { SessionStateBadge, When } from "@/components/agents/agent-status";
import { DataUnavailable } from "@/components/dashboard/data-unavailable";
import { PageHeader } from "@/components/dashboard/page-header";
import { NotAvailable } from "@/components/github/github-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getAgentSession, type AgentSessionDetail } from "@/server/services/agent-service";
import { load } from "@/server/services/load";

export const metadata: Metadata = { title: "Agent session" };
export const dynamic = "force-dynamic";

export default async function AgentSessionPage({ params }: PageProps<"/agents/[id]">) {
  const { id } = await params;
  const result = await load(() => getAgentSession(id));
  if (result.ok && !result.data) notFound();

  return result.ok && result.data ? (
    <SessionContent detail={result.data} />
  ) : (
    <>
      <PageHeader title="Agent session" />
      {!result.ok && <DataUnavailable error={result.error} />}
    </>
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

function Counts({ rows }: { rows: { tool: string; count: number }[] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {rows.map(({ tool, count }) => (
        <li key={tool} className="flex items-center justify-between gap-3">
          <span className="truncate font-mono">{tool}</span>
          <span className="tabular-nums text-muted-foreground">{formatNumber(count)}</span>
        </li>
      ))}
    </ul>
  );
}

const eventLabel = (type: string) => (isSessionEventType(type) ? SESSION_EVENT_LABELS[type] : type);

/** Error or abort code the tool recorded, if any (stored by the db layer as { code }). */
function errorCode(payload: unknown): string | null {
  return payload &&
    typeof payload === "object" &&
    "code" in payload &&
    typeof payload.code === "string"
    ? payload.code
    : null;
}

function SessionContent({ detail }: { detail: AgentSessionDetail }) {
  const { session, state, bridge, models, tokens } = detail;
  const title = session.title ?? session.externalId;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/agents" className="hover:text-foreground">
          AI Agents
        </Link>{" "}
        / <span aria-current="page">{title}</span>
      </nav>
      <PageHeader title={title} description={`${AGENT_SOURCE_LABELS[session.source]} session`} />

      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="flex flex-col items-start gap-1">
            <SessionStateBadge state={state} />
            <span className="text-xs text-muted-foreground">
              {state.kind === "unverified" ? (
                <>{state.reason} Showing last observed activity.</>
              ) : (
                <>
                  Live check <When date={state.checkedAt} />
                </>
              )}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last activity</dt>
          <dd>{session.lastEventAt ? formatDateTime(session.lastEventAt) : <NotAvailable />}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Started</dt>
          <dd>{session.startedAt ? formatDateTime(session.startedAt) : <NotAvailable />}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Model</dt>
          <dd className="font-mono text-xs">
            {models.length > 0 ? models.map((m) => m.model).join(", ") : <NotAvailable />}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Project</dt>
          <dd>
            {session.project ? (
              <Link href={`/projects/${session.project.id}`} className="hover:underline">
                {session.project.name}
              </Link>
            ) : (
              "Unassigned"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Working folder</dt>
          <dd className="font-mono text-xs break-all">{session.cwd ?? <NotAvailable />}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Branch</dt>
          <dd className="font-mono text-xs">{session.gitBranch ?? <NotAvailable />}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Session id</dt>
          <dd className="font-mono text-xs break-all">{session.externalId}</dd>
        </div>
        {session.details.map(({ label, value }) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-xs break-all">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-muted-foreground">
        {bridge.status ? (
          <>
            Data as of the bridge&apos;s last report,{" "}
            <When date={new Date(bridge.status.lastSeenAt)} />.
          </>
        ) : (
          "The Agent Bridge hasn't reported yet."
        )}{" "}
        {formatNumber(detail.eventCount)} events from{" "}
        <span className="font-mono break-all">{session.sourcePath}</span>
        {session.skippedRecordCount > 0 && (
          <span className="text-warning">
            {" "}
            · {formatNumber(session.skippedRecordCount)} records not recognised and skipped
          </span>
        )}
      </p>

      <Section title="Token usage">
        {!tokens ? (
          <None>No token usage recorded for this session.</None>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Model</TableHead>
                <TableHead className="text-right">Responses</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Reasoning</TableHead>
                <TableHead className="text-right">Cache read</TableHead>
                <TableHead className="text-right">Cache write</TableHead>
                <TableHead className="pr-6 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((m) => (
                <TableRow key={m.model}>
                  <TableCell className="pl-6 font-mono text-xs">{m.model}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(m.responses)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(m.inputTokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(m.outputTokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(m.reasoningTokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(m.cacheReadTokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(m.cacheWriteTokens)}
                  </TableCell>
                  <TableCell className="pr-6 text-right font-medium tabular-nums">
                    {formatNumber(totalTokens(m))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={`Errors (${formatNumber(detail.errorCount)})`}>
          {detail.errors.length === 0 ? (
            <None>No tool or API errors recorded.</None>
          ) : (
            <CardContent className="pb-6">
              <ul className="flex flex-col gap-3 text-sm">
                {detail.errors.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-medium text-destructive">
                        {eventLabel(event.type)}
                        {errorCode(event.payload) && (
                          <span className="font-mono text-xs"> · {errorCode(event.payload)}</span>
                        )}
                      </span>
                      <span className="block break-words text-muted-foreground">
                        {event.summary}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      <When date={event.occurredAt} />
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Section>

        <Section title="Tools used">
          {detail.tools.length === 0 ? (
            <None>No tool use recorded.</None>
          ) : (
            <CardContent className="pb-6">
              <Counts rows={detail.tools} />
            </CardContent>
          )}
        </Section>

        {PROVIDER_CAPABILITIES[session.source].operations && (
          <Section title="Turns and operations">
            <CardContent className="flex flex-col gap-3 pb-6 text-sm">
              <p>
                Turns completed: {formatNumber(detail.turns.completed)} · aborted:{" "}
                {formatNumber(detail.turns.aborted)} · failed: {formatNumber(detail.turns.failed)}
              </p>
              {detail.operations.length === 0 ? (
                <p className="text-muted-foreground">No completed operations recorded.</p>
              ) : (
                <Counts rows={detail.operations} />
              )}
            </CardContent>
          </Section>
        )}
      </div>

      <Section title="Activity timeline">
        {detail.timeline.length === 0 ? (
          <None>No activity recorded.</None>
        ) : (
          <CardContent className="pb-6">
            {detail.eventCount > detail.timeline.length && (
              <p className="mb-3 text-xs text-muted-foreground">
                The latest {formatNumber(detail.timeline.length)} of{" "}
                {formatNumber(detail.eventCount)} events.
              </p>
            )}
            <ol className="flex flex-col gap-2 text-sm">
              {detail.timeline.map((event) => (
                <li key={event.id} className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span
                      className={
                        event.type.endsWith(".error")
                          ? "font-medium text-destructive"
                          : "font-medium"
                      }
                    >
                      {eventLabel(event.type)}
                    </span>
                    {event.summary && (
                      <span className="text-muted-foreground"> · {event.summary}</span>
                    )}
                    {!event.summary && errorCode(event.payload) && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {" "}
                        · {errorCode(event.payload)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    <time dateTime={event.occurredAt.toISOString()}>
                      {formatDateTime(event.occurredAt)}
                    </time>
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        )}
      </Section>
    </>
  );
}
