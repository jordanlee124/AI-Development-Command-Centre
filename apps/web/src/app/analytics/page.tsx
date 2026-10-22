import type { Metadata } from "next";
import { ChartColumn } from "lucide-react";
import { totalTokens, type TokenTotals } from "@/domain/agent";
import { DataUnavailable } from "@/components/dashboard/data-unavailable";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { getUsage, USAGE_WINDOW_DAYS } from "@/server/services/dashboard-service";
import { load } from "@/server/services/load";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const result = await load(() => getUsage());

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`Token usage reported by agent tools over the last ${USAGE_WINDOW_DAYS} days.`}
      />
      {!result.ok ? (
        <DataUnavailable error={result.error} />
      ) : result.data === null ? (
        <EmptyState
          icon={ChartColumn}
          title="No usage data"
          description="Token counts come only from real Claude Code and Codex sessions (Phase 5). Charts and cost (calculated from a price table) arrive in Phase 7."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Tokens by model</h2>
            </CardTitle>
            <CardDescription>Exact counts as reported. Cost is not calculated yet.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Model</TableHead>
                  {TOKEN_COLUMNS.map(({ label }) => (
                    <TableHead key={label} className="text-right">
                      {label}
                    </TableHead>
                  ))}
                  <TableHead className="pr-6 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.byModel.map((row) => (
                  <TableRow key={row.model}>
                    <TableCell className="pl-6 font-mono text-xs">{row.model}</TableCell>
                    <TokenCells totals={row} />
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-6">All models</TableCell>
                  <TokenCells totals={result.data.totals} />
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
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

function TokenCells({ totals }: { totals: TokenTotals }) {
  return (
    <>
      {TOKEN_COLUMNS.map(({ key }) => (
        <TableCell key={key} className="text-right tabular-nums">
          {formatNumber(totals[key])}
        </TableCell>
      ))}
      <TableCell className="pr-6 text-right font-medium tabular-nums">
        {formatNumber(totalTokens(totals))}
      </TableCell>
    </>
  );
}
