import type { Metadata } from "next";
import Link from "next/link";
import {
  ChartColumn,
  CircleCheck,
  Coins,
  Download,
  Hash,
  Info,
  Receipt,
  Settings2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  AGENT_SOURCE_LABELS,
  AGENT_SOURCES,
  PROVIDER_CAPABILITIES,
  totalTokens,
  type TokenTotals,
} from "@/domain/agent";
import {
  BILLING_LABELS,
  BILLING_MEANING,
  lastDays,
  PERIOD_LABELS,
  PERIODS,
  RANGE_PRESETS,
  type BudgetMeter,
  type DateRange,
  type Period,
  type TrendPoint,
  type UsageSummary,
} from "@/domain/analytics";
import { BreakdownChart, TrendChart, type TrendDatum } from "@/components/analytics/usage-charts";
import { DataUnavailable } from "@/components/dashboard/data-unavailable";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { AgentBadge } from "@/components/dashboard/status-badges";
import { NotAvailable } from "@/components/github/github-badges";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCompact, formatDay, formatNumber, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getAnalytics, type Analytics } from "@/server/services/analytics-service";
import { load } from "@/server/services/load";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const SESSION_LIMIT = 25;
const CHART_ROWS = 8;

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const query = await searchParams;
  const result = await load(() => getAnalytics(query));

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Token usage recorded from Claude Code and Codex session files, with API-equivalent cost estimates from your own price table."
      >
        <Link href="/analytics/settings" className={buttonVariants({ variant: "outline" })}>
          <Settings2 aria-hidden /> Prices and budgets
        </Link>
      </PageHeader>
      {!result.ok ? (
        <DataUnavailable error={result.error} />
      ) : result.data.firstDay === null ? (
        <EmptyState
          icon={ChartColumn}
          title="No usage data"
          description="Token counts come only from real Claude Code and Codex sessions read by the Agent Bridge. Nothing has been recorded yet, so there is nothing to chart or estimate."
        />
      ) : (
        <AnalyticsView data={result.data} />
      )}
    </>
  );
}

function rangeHref(range: DateRange, period: Period) {
  return `/analytics?${new URLSearchParams({ from: range.from, to: range.to, period })}`;
}

const pill = (active: boolean) =>
  cn(
    "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
    active && "bg-accent font-medium text-foreground",
  );

function RangeControls({ data }: { data: Analytics }) {
  const { range, period, today } = data;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Date range" className="flex flex-wrap gap-1">
          {RANGE_PRESETS.map((days) => {
            const preset = lastDays(days, today);
            const active = preset.from === range.from && preset.to === range.to;
            return (
              <Link
                key={days}
                href={rangeHref(preset, period)}
                aria-current={active ? "page" : undefined}
                className={pill(active)}
              >
                {days === 365 ? "12 months" : `${days} days`}
              </Link>
            );
          })}
        </nav>
        <nav aria-label="Trend period" className="flex flex-wrap gap-1">
          {PERIODS.map((value) => (
            <Link
              key={value}
              href={rangeHref(range, value)}
              aria-current={value === period ? "page" : undefined}
              className={pill(value === period)}
            >
              {PERIOD_LABELS[value]}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="get" action="/analytics" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value={period} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="range-from">From</Label>
            <Input id="range-from" name="from" type="date" defaultValue={range.from} max={today} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="range-to">To</Label>
            <Input id="range-to" name="to" type="date" defaultValue={range.to} max={today} />
          </div>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
        <a
          href={`/analytics/export?${new URLSearchParams({ from: range.from, to: range.to })}`}
          download
          className={buttonVariants({ variant: "outline" })}
        >
          <Download aria-hidden /> Export CSV
        </a>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatDay(range.from)} – {formatDay(range.to)}. Days are calendar days in {data.timeZone}.
      </p>
    </div>
  );
}

function AnalyticsView({ data }: { data: Analytics }) {
  const { usage } = data;
  const empty = usage.totals.records === 0;
  return (
    <>
      <RangeControls data={data} />
      {data.notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {data.notice}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Recorded tokens"
          value={formatCompact(totalTokens(usage.totals))}
          hint={`${formatNumber(totalTokens(usage.totals))} tokens · ${formatNumber(usage.totals.records)} responses`}
          icon={Hash}
        />
        <StatCard
          label="Estimated API-equivalent cost"
          value={costText(usage.totals)}
          hint={costHint(usage.totals)}
          icon={Coins}
        />
        <StatCard
          label="Billed cost"
          value={null}
          hint="Not available: no billing source is connected"
          icon={Receipt}
        />
        <StatCard
          label="Sessions"
          value={formatNumber(usage.totals.sessions)}
          hint="With recorded usage in this range"
          icon={ChartColumn}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <NumberKinds data={data} />
        <BudgetCard data={data} />
      </div>
      {empty ? (
        <EmptyState
          icon={ChartColumn}
          title="No usage in this range"
          description={`Usage has been recorded since ${formatDay(data.firstDay ?? data.range.from)}, but none between these dates. Pick a wider range.`}
        />
      ) : (
        <>
          <TrendCards data={data} />
          <ProviderComparison data={data} />
          <ModelBreakdown data={data} />
          <ProjectBreakdown data={data} />
          <SessionBreakdown data={data} />
        </>
      )}
      <MissingData data={data} />
    </>
  );
}

// --- Cost display: an estimate, a lower bound, or unknown; never 0 for "no price" ---

function costText(s: UsageSummary): string | null {
  const total = totalTokens(s);
  if (total > 0 && s.unpricedTokens === total) return null;
  return s.unpricedTokens > 0 ? `≥ ${formatUsd(s.estimatedUsd)}` : formatUsd(s.estimatedUsd);
}

function costHint(s: UsageSummary): string {
  if (s.unpricedTokens === 0) return "Estimate from your price table, not a charge";
  if (s.unpricedTokens === totalTokens(s)) return "No prices cover this usage yet";
  return `At least: ${formatCompact(s.unpricedTokens)} tokens have no price`;
}

function CostCell({ summary }: { summary: UsageSummary }) {
  const text = costText(summary);
  return (
    <TableCell className="text-right tabular-nums">
      {text === null ? (
        <span className="text-muted-foreground">No price</span>
      ) : summary.unpricedTokens > 0 ? (
        <span title={`At least: ${formatNumber(summary.unpricedTokens)} tokens have no price`}>
          {text}
        </span>
      ) : (
        text
      )}
    </TableCell>
  );
}

// Every TokenTotals field is shown, so the visible cells always add up to Total.
const TOKEN_COLUMNS: { label: string; key: keyof TokenTotals }[] = [
  { label: "Input", key: "inputTokens" },
  { label: "Output", key: "outputTokens" },
  { label: "Reasoning", key: "reasoningTokens" },
  { label: "Cache read", key: "cacheReadTokens" },
  { label: "Cache write", key: "cacheWriteTokens" },
];

function TokenHeads() {
  return (
    <>
      {TOKEN_COLUMNS.map(({ label }) => (
        <TableHead key={label} className="text-right">
          {label}
        </TableHead>
      ))}
      <TableHead className="text-right">Total</TableHead>
    </>
  );
}

function TokenCells({ totals }: { totals: TokenTotals }) {
  return (
    <>
      {TOKEN_COLUMNS.map(({ key }) => (
        <TableCell key={key} className="text-right tabular-nums">
          {formatNumber(totals[key])}
        </TableCell>
      ))}
      <TableCell className="text-right font-medium tabular-nums">
        {formatNumber(totalTokens(totals))}
      </TableCell>
    </>
  );
}

function Section({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <Card id={id}>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function NumberKinds({ data }: { data: Analytics }) {
  const kinds: { icon: LucideIcon; title: string; body: React.ReactNode }[] = [
    {
      icon: Hash,
      title: "Recorded tokens · verified",
      body: "Counted from the token usage each tool wrote in its session files on this machine (approved folders only). Not an invoice.",
    },
    {
      icon: Coins,
      title: "Estimated API-equivalent cost · estimate",
      body: (
        <>
          Recorded tokens × the prices you entered ({formatNumber(data.priceCount)} price version
          {data.priceCount === 1 ? "" : "s"}). What the usage would cost at API rates, never a
          charge. Each price shows its source on{" "}
          <Link href="/analytics/settings" className="underline underline-offset-2">
            Prices and budgets
          </Link>
          .
        </>
      ),
    },
    {
      icon: Receipt,
      title: "Billed cost · not available",
      body: "ADCC reads no billing source, so what you were actually charged isn't known. Your provider's console has it.",
    },
  ];
  return (
    <Section title="What these numbers are">
      <ul className="flex flex-col gap-3 text-sm">
        {kinds.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-3">
            <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <div className="font-medium">{title}</div>
              <p className="text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
        {AGENT_SOURCES.map((source) => {
          const billing = data.settings.billing[source];
          return (
            <li key={source} className="flex gap-3">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <div className="font-medium">
                  {AGENT_SOURCE_LABELS[source]} billing · {BILLING_LABELS[billing]}
                </div>
                <p className="text-muted-foreground">{BILLING_MEANING[billing]}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

const LEVELS: Record<
  BudgetMeter["level"],
  { label: string; icon: LucideIcon; tone: string; bar: string }
> = {
  ok: { label: "Within budget", icon: CircleCheck, tone: "text-success", bar: "" },
  warning: {
    label: "Near budget",
    icon: TriangleAlert,
    tone: "text-warning",
    bar: "[&_[data-slot=progress-indicator]]:bg-warning",
  },
  over: {
    label: "Budget reached",
    icon: TriangleAlert,
    tone: "text-destructive",
    bar: "[&_[data-slot=progress-indicator]]:bg-destructive",
  },
};

function BudgetMeterRow({
  label,
  meter,
  format,
}: {
  label: string;
  meter: BudgetMeter;
  format: (n: number) => string;
}) {
  const level = LEVELS[meter.level];
  const Icon = level.icon;
  return (
    <li className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {meter.lowerBound && "at least "}
          {format(meter.used)} of {format(meter.limit)} · {Math.floor(meter.percent)}%
        </span>
      </div>
      <Progress
        value={Math.min(meter.percent, 100)}
        aria-label={`${label}: ${Math.floor(meter.percent)}% of budget`}
        className={level.bar}
      />
      <span className={cn("flex items-center gap-1.5 text-xs", level.tone)}>
        <Icon aria-hidden className="size-3.5" /> {level.label}
        {meter.lowerBound && (
          <span className="text-muted-foreground">
            · some usage has no price, so the real figure is higher
          </span>
        )}
      </span>
    </li>
  );
}

function BudgetCard({ data }: { data: Analytics }) {
  const { budget, month } = data;
  return (
    <Section
      title="Monthly budget"
      description={`Month to date, ${formatDay(month.from)} – ${formatDay(month.to)}, whatever range is shown above. Warns at ${data.settings.budget.warnPercent}%.`}
    >
      {!budget.tokens && !budget.cost ? (
        <p className="text-sm text-muted-foreground">
          No budget set.{" "}
          <Link href="/analytics/settings" className="underline underline-offset-2">
            Set a token or cost budget
          </Link>{" "}
          to see how this month compares.
        </p>
      ) : (
        <ul className="flex flex-col gap-5">
          {budget.tokens && (
            <BudgetMeterRow label="Recorded tokens" meter={budget.tokens} format={formatCompact} />
          )}
          {budget.cost && (
            <BudgetMeterRow
              label="Estimated API-equivalent cost"
              meter={budget.cost}
              format={formatUsd}
            />
          )}
        </ul>
      )}
    </Section>
  );
}

function periodLabel(start: string, period: Period) {
  const date = new Date(`${start}T00:00:00Z`);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    ...(period === "month"
      ? { month: "short", year: "numeric" }
      : { month: "short", day: "numeric" }),
  }).format(date);
}

function trendData(points: TrendPoint[], period: Period, unit: "tokens" | "usd"): TrendDatum[] {
  return points.map((point) => {
    const values = unit === "tokens" ? point.tokens : point.estimatedUsd;
    if (point.noData) {
      return { label: periodLabel(point.start, period), note: "No usage recorded this far back" };
    }
    return {
      label: periodLabel(point.start, period),
      note:
        unit === "usd" && point.unpricedTokens > 0
          ? `Excludes ${formatCompact(point.unpricedTokens)} tokens with no price`
          : null,
      ...values,
    };
  });
}

function TrendTable({
  points,
  period,
  unit,
}: {
  points: TrendPoint[];
  period: Period;
  unit: "tokens" | "usd";
}) {
  const format = unit === "usd" ? formatUsd : formatNumber;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
      <Table className="mt-2">
        <TableHeader>
          <TableRow>
            <TableHead>
              {period === "week" ? "Week of" : period === "month" ? "Month" : "Day"}
            </TableHead>
            {AGENT_SOURCES.map((s) => (
              <TableHead key={s} className="text-right">
                {AGENT_SOURCE_LABELS[s]}
              </TableHead>
            ))}
            {unit === "usd" && <TableHead className="text-right">Unpriced tokens</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((point) => (
            <TableRow key={point.start}>
              <TableCell>{periodLabel(point.start, period)}</TableCell>
              {AGENT_SOURCES.map((s) => (
                <TableCell key={s} className="text-right tabular-nums">
                  {point.noData ? (
                    <NotAvailable />
                  ) : (
                    format((unit === "usd" ? point.estimatedUsd : point.tokens)[s])
                  )}
                </TableCell>
              ))}
              {unit === "usd" && (
                <TableCell className="text-right tabular-nums">
                  {point.noData ? <NotAvailable /> : formatNumber(point.unpricedTokens)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </details>
  );
}

function TrendCards({ data }: { data: Analytics }) {
  const { trend } = data.usage;
  const period = PERIOD_LABELS[data.period].toLowerCase();
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section
        title="Recorded tokens over time"
        description={`Verified counts, ${period}, by tool.`}
      >
        <TrendChart
          data={trendData(trend, data.period, "tokens")}
          unit="tokens"
          label={`Recorded tokens ${period} by tool. The table below has the same numbers.`}
        />
        <TrendTable points={trend} period={data.period} unit="tokens" />
      </Section>
      <Section
        title="Estimated API-equivalent cost over time"
        description={`An estimate from your price table, ${period}, by tool. Usage with no price is left out, not counted as $0.`}
      >
        {data.usage.totals.unpricedTokens === totalTokens(data.usage.totals) ? (
          // An empty chart would read as $0; say there's nothing to estimate instead.
          <EmptyState
            icon={Coins}
            title="Nothing to estimate yet"
            description="No price in your price table covers the usage in this range."
          >
            <Link href="/analytics/settings" className={buttonVariants({ variant: "outline" })}>
              Add prices
            </Link>
          </EmptyState>
        ) : (
          <>
            <TrendChart
              data={trendData(trend, data.period, "usd")}
              unit="usd"
              label={`Estimated API-equivalent cost ${period} by tool. The table below has the same numbers.`}
            />
            <TrendTable points={trend} period={data.period} unit="usd" />
          </>
        )}
      </Section>
    </div>
  );
}

function ProviderComparison({ data }: { data: Analytics }) {
  return (
    <Section
      title="By tool"
      description="Claude Code (Anthropic models) and Codex (OpenAI models), side by side."
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tool</TableHead>
            <TableHead>Billing</TableHead>
            <TableHead className="text-right">Sessions</TableHead>
            <TokenHeads />
            <TableHead className="text-right">Est. cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.usage.byProvider.map((row) => (
            <TableRow key={row.source}>
              <TableCell>
                <AgentBadge agent={row.source} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {BILLING_LABELS[data.settings.billing[row.source]]}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.sessions)}
              </TableCell>
              <TokenCells totals={row} />
              <CostCell summary={row} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        {AGENT_SOURCES.map((source) => (
          <li key={source}>
            <span className="font-medium text-foreground">{AGENT_SOURCE_LABELS[source]}:</span>{" "}
            {PROVIDER_CAPABILITIES[source].usage}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Top rows for a chart; the rest fold into "Other" so every token is still drawn. */
function chartRows(rows: { label: string; tokens: number }[]) {
  if (rows.length <= CHART_ROWS) return rows;
  const rest = rows.slice(CHART_ROWS - 1).reduce((sum, row) => sum + row.tokens, 0);
  return [...rows.slice(0, CHART_ROWS - 1), { label: "Other", tokens: rest }];
}

function ModelBreakdown({ data }: { data: Analytics }) {
  const rows = data.usage.byModel;
  return (
    <Section title="By model" description="Model ids exactly as the tools recorded them.">
      <BreakdownChart
        data={chartRows(rows.map((row) => ({ label: row.model, tokens: totalTokens(row) })))}
        label="Recorded tokens by model. The table below has the same numbers."
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TokenHeads />
            <TableHead className="text-right">Est. cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.model}>
              <TableCell className="font-mono text-xs">
                {row.model}
                {row.unpricedReasons.length > 0 && (
                  <span className="block font-sans text-muted-foreground">
                    {row.unpricedReasons.join("; ")}
                  </span>
                )}
              </TableCell>
              <TokenCells totals={row} />
              <CostCell summary={row} />
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>All models</TableCell>
            <TokenCells totals={data.usage.totals} />
            <CostCell summary={data.usage.totals} />
          </TableRow>
        </TableFooter>
      </Table>
    </Section>
  );
}

function ProjectBreakdown({ data }: { data: Analytics }) {
  const rows = data.usage.byProject;
  return (
    <Section
      title="By project"
      description="A session belongs to the project whose local folder holds its working folder."
    >
      <BreakdownChart
        data={chartRows(rows.map((row) => ({ label: row.name, tokens: totalTokens(row) })))}
        label="Recorded tokens by project. The table below has the same numbers."
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead className="text-right">Sessions</TableHead>
            <TableHead className="text-right">Input</TableHead>
            <TableHead className="text-right">Output</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Est. cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.projectId ?? "unassigned"}>
              <TableCell>
                {row.projectId ? (
                  <Link href={`/projects/${row.projectId}`} className="font-medium hover:underline">
                    {row.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.sessions)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.inputTokens)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.outputTokens)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatNumber(totalTokens(row))}
              </TableCell>
              <CostCell summary={row} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

function SessionBreakdown({ data }: { data: Analytics }) {
  const rows = data.usage.bySession;
  return (
    <Section
      title="By session"
      description={
        rows.length > SESSION_LIMIT
          ? `The ${SESSION_LIMIT} sessions with the most tokens, of ${formatNumber(rows.length)}. The CSV export has them all.`
          : "Every session with usage in this range."
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Session</TableHead>
            <TableHead>Tool</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Est. cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, SESSION_LIMIT).map((row) => (
            <TableRow key={row.sessionId}>
              <TableCell className="max-w-72">
                <Link
                  href={`/agents/${row.sessionId}`}
                  className="block truncate font-medium hover:underline"
                >
                  {row.label}
                </Link>
              </TableCell>
              <TableCell>
                <AgentBadge agent={row.source} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.projectName ?? "Unassigned"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {row.models[0]}
                {row.models.length > 1 && (
                  <span className="block text-muted-foreground">+{row.models.length - 1} more</span>
                )}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatNumber(totalTokens(row))}
              </TableCell>
              <CostCell summary={row} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

function MissingData({ data }: { data: Analytics }) {
  const { usage, range, firstDay, settings } = data;
  const total = totalTokens(usage.totals);
  const unassigned = usage.byProject.find((row) => row.projectId === null);
  const unsetBilling = usage.byProvider.filter(
    (row) => row.records > 0 && settings.billing[row.source] === "UNSET",
  );
  const items = [
    usage.totals.unpricedTokens > 0 && (
      <>
        {formatNumber(usage.totals.unpricedTokens)} of {formatNumber(total)} tokens (
        {Math.round((usage.totals.unpricedTokens / total) * 100)}%) have no cost estimate:{" "}
        {usage.totals.unpricedReasons.join("; ").toLowerCase()}. Cost figures leave them out.{" "}
        <Link href="/analytics/settings" className="underline underline-offset-2">
          Add prices
        </Link>
        .
      </>
    ),
    unassigned && (
      <>
        {formatNumber(totalTokens(unassigned))} tokens from {formatNumber(unassigned.sessions)}{" "}
        session{unassigned.sessions === 1 ? "" : "s"} aren&apos;t linked to a project: no
        project&apos;s local folder holds their working folder.
      </>
    ),
    usage.sessionsWithSkippedRecords > 0 && (
      <>
        {formatNumber(usage.sessionsWithSkippedRecords)} session
        {usage.sessionsWithSkippedRecords === 1 ? " has" : "s have"} records the bridge
        couldn&apos;t read, so {usage.sessionsWithSkippedRecords === 1 ? "its" : "their"} counts may
        be incomplete.
      </>
    ),
    firstDay !== null && range.from < firstDay && (
      <>Usage is recorded from {formatDay(firstDay)}. Earlier periods show no data, not zero.</>
    ),
    unsetBilling.length > 0 && (
      <>
        Billing type isn&apos;t set for {unsetBilling.map((row) => row.label).join(" and ")}, so
        whether you pay per token is unknown.{" "}
        <Link href="/analytics/settings" className="underline underline-offset-2">
          Set it
        </Link>
        .
      </>
    ),
    <>Billed cost isn&apos;t available from any source.</>,
  ].filter((item) => item !== false && item !== undefined);

  return (
    <Section title="Missing data" description="What these figures can't include, for this range.">
      <ul className="flex flex-col gap-2 text-sm">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
