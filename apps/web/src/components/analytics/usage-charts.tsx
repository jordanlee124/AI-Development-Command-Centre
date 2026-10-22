"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { AGENT_SOURCE_LABELS, AGENT_SOURCES, type AgentSource } from "@/domain/agent";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCompact, formatNumber, formatUsd } from "@/lib/format";

// chart-1 / chart-4: the theme pair that passes the CVD and contrast checks in both themes.
const SOURCE_COLORS: Record<AgentSource, string> = {
  CLAUDE_CODE: "var(--chart-1)",
  CODEX: "var(--chart-4)",
};
const sourceConfig = Object.fromEntries(
  AGENT_SOURCES.map((s) => [s, { label: AGENT_SOURCE_LABELS[s], color: SOURCE_COLORS[s] }]),
) satisfies ChartConfig;

export type Unit = "tokens" | "usd";

const formatValue = (unit: Unit, value: number) =>
  unit === "usd" ? formatUsd(value) : formatNumber(value);
const formatTick = (unit: Unit, value: number) =>
  unit === "usd" ? `$${formatCompact(value)}` : formatCompact(value);

export interface TrendDatum extends Partial<Record<AgentSource, number>> {
  label: string;
  /** Shown under the period in the tooltip, e.g. "No usage recorded yet". */
  note: string | null;
}

/** Stacked columns per period, one segment per tool. Periods with no data have no bar. */
export function TrendChart({
  data,
  unit,
  label,
}: {
  data: TrendDatum[];
  unit: Unit;
  label: string;
}) {
  return (
    <ChartContainer
      config={sourceConfig}
      className="aspect-auto h-64 w-full"
      role="figure"
      aria-label={label}
    >
      <BarChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} strokeWidth={1} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(value: number) => formatTick(unit, value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value, payload) => {
                const note = (payload[0]?.payload as TrendDatum | undefined)?.note;
                return (
                  <>
                    {value}
                    {note && (
                      <span className="block font-normal text-muted-foreground">{note}</span>
                    )}
                  </>
                );
              }}
              formatter={(value, name, item) => (
                <TooltipRow
                  color={item.color}
                  name={String(name)}
                  value={formatValue(unit, Number(value))}
                />
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {AGENT_SOURCES.map((source, i) => (
          <Bar
            key={source}
            dataKey={source}
            stackId="usage"
            fill={`var(--color-${source})`}
            maxBarSize={24}
            stroke="var(--card)"
            strokeWidth={2}
            // Only the top segment gets the rounded data-end.
            radius={i === AGENT_SOURCES.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

const singleConfig = { tokens: { label: "Tokens", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Horizontal bars, one per row, largest first. Long labels are cut; the table has them whole. */
export function BreakdownChart({
  data,
  label,
}: {
  data: { label: string; tokens: number }[];
  label: string;
}) {
  return (
    <ChartContainer
      config={singleConfig}
      className="aspect-auto w-full"
      style={{ height: data.length * 36 + 24 }}
      role="figure"
      aria-label={label}
    >
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16 }}>
        <CartesianGrid horizontal={false} strokeWidth={1} />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatCompact(value)}
        />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={160}
          tickFormatter={(value: string) => (value.length > 24 ? `${value.slice(0, 23)}…` : value)}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value, name, item) => (
                <TooltipRow color={item.color} name="Tokens" value={formatNumber(Number(value))} />
              )}
            />
          }
        />
        <Bar dataKey="tokens" fill="var(--color-tokens)" maxBarSize={24} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

function TooltipRow({ color, name, value }: { color?: string; name: string; value: string }) {
  return (
    <div className="flex w-full items-center gap-2">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-[2px]"
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground">
        {name in sourceConfig ? AGENT_SOURCE_LABELS[name as AgentSource] : name}
      </span>
      <span className="ml-auto font-mono font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}
