import type { ProviderStatus } from "@adcc/shared";
import {
  AGENT_SOURCE_LABELS,
  PROVIDER_CAPABILITIES,
  type BridgeConnection,
  type SessionState,
} from "@/domain/agent";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AgentsOverview } from "@/server/services/agent-service";

const SUCCESS = "border-success/40 text-success";
const WARNING = "border-warning/40 text-warning";
const RUNNING = "border-primary/40 text-primary dark:text-ring";
const MUTED = "text-muted-foreground";

export function When({ date }: { date: Date }) {
  return (
    <time dateTime={date.toISOString()} title={formatDateTime(date)}>
      {formatRelative(date)}
    </time>
  );
}

/** "busy" → "Busy" */
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Running/not running only from a fresh live check; otherwise says it can't tell. */
export function SessionStateBadge({ state }: { state: SessionState }) {
  if (state.kind === "running") {
    return (
      <Badge
        variant="outline"
        className={RUNNING}
        title={`Listed by claude agents --json at ${formatDateTime(state.checkedAt)}`}
      >
        Running{state.status ? ` · ${capitalize(state.status)}` : ""}
      </Badge>
    );
  }
  if (state.kind === "not-running") {
    return (
      <Badge
        variant="outline"
        className={MUTED}
        title={`Not listed by claude agents --json at ${formatDateTime(state.checkedAt)}`}
      >
        Not running
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={MUTED} title={`${state.reason} Showing last activity.`}>
      Unverified
    </Badge>
  );
}

function ConnectionBadge({
  configured,
  connection,
}: {
  configured: boolean;
  connection: BridgeConnection;
}) {
  if (!configured)
    return (
      <Badge variant="outline" className={MUTED}>
        Not configured
      </Badge>
    );
  const [label, tone] = {
    never: ["Never connected", MUTED],
    connected: ["Connected", SUCCESS],
    stale: ["Not reporting", WARNING],
  }[connection.kind];
  return (
    <Badge variant="outline" className={cn(tone)}>
      {label}
    </Badge>
  );
}

/** Connection status and data freshness for everything on the agent pages. */
export function BridgeStatusCard({ bridge }: { bridge: AgentsOverview["bridge"] }) {
  const { configured, status, connection } = bridge;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle>
            <h2>Agent Bridge</h2>
          </CardTitle>
          <CardDescription>
            Reads Claude Code and Codex session metadata on this machine. Read-only: it runs nothing
            except the Claude Code live session check.
          </CardDescription>
        </div>
        <ConnectionBadge configured={configured} connection={connection} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {!configured ? (
          <p className="text-muted-foreground">
            Set <code className="font-mono">ADCC_BRIDGE_TOKEN</code> in{" "}
            <code className="font-mono">apps/web/.env</code> and{" "}
            <code className="font-mono">apps/bridge/.env</code>, restart ADCC, then run{" "}
            <code className="font-mono">pnpm bridge</code>. See DEVELOPMENT.md.
          </p>
        ) : !status ? (
          <p className="text-muted-foreground">
            No report yet. Start the bridge with <code className="font-mono">pnpm bridge</code>.
          </p>
        ) : (
          <>
            {connection.kind === "stale" && (
              <p role="status" className="text-warning">
                No report since <When date={connection.lastSeenAt} />. Session status can&apos;t be
                verified, so the last observed activity is shown instead.
              </p>
            )}
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Last report</dt>
                <dd>
                  <When date={new Date(status.lastSeenAt)} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Live session check (Claude Code)</dt>
                <dd>
                  {status.live.ok ? (
                    <>
                      Checked <When date={new Date(status.live.checkedAt)} />
                    </>
                  ) : (
                    <span className="text-destructive">Failed: {status.live.error}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Approved folders</dt>
                <dd>
                  <ul className="font-mono text-xs">
                    {status.approvedFolders.map((folder) => (
                      <li key={folder} className="break-all">
                        {folder}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Bridge version</dt>
                <dd>
                  {status.version} · every {status.pollSeconds} s
                </dd>
              </div>
            </dl>
            {status.providers.length > 0 && <ProviderDiagnostics providers={status.providers} />}
            {status.errors.length > 0 && (
              <div role="alert" className="rounded-lg border border-warning/40 p-3 text-warning">
                <p className="font-medium">The bridge reported problems:</p>
                <ul className="list-disc pl-5">
                  {status.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Per tool: where the bridge reads, what it found, and what that tool can report. */
function ProviderDiagnostics({ providers }: { providers: ProviderStatus[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">Sources</h3>
      <ul className="grid gap-3 lg:grid-cols-2">
        {providers.map((provider) => {
          const capabilities = PROVIDER_CAPABILITIES[provider.source];
          return (
            <li key={provider.source} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{AGENT_SOURCE_LABELS[provider.source]}</span>
                {provider.error ? (
                  <Badge variant="outline" className={WARNING}>
                    {provider.files === 0 ? "Unavailable" : "Partly readable"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className={SUCCESS}>
                    Readable
                  </Badge>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Folder</dt>
                <dd className="font-mono break-all">{provider.dataDir}</dd>
                <dt className="text-muted-foreground">Session files</dt>
                <dd>
                  {formatNumber(provider.files)} found; only sessions in approved folders are sent
                </dd>
                <dt className="text-muted-foreground">Live status</dt>
                <dd>{capabilities.liveStatus ?? "Not available: last activity only"}</dd>
                <dt className="text-muted-foreground">Titles</dt>
                <dd>{capabilities.titles}</dd>
              </dl>
              {provider.error && (
                <p role="status" className="mt-2 text-xs break-words text-warning">
                  {provider.error}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
