import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus, Tags } from "lucide-react";
import { AnalyticsSettingsForm } from "@/components/analytics/settings-form";
import { DeletePriceButton, PriceFormDialog } from "@/components/analytics/price-form";
import { DataUnavailable } from "@/components/dashboard/data-unavailable";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { NotAvailable } from "@/components/github/github-badges";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PriceVersion } from "@/domain/pricing";
import { addDays } from "@/domain/analytics";
import { formatDay, formatNumber } from "@/lib/format";
import { getAnalyticsSettingsPage, serverTimeZone } from "@/server/services/analytics-service";
import { load } from "@/server/services/load";

export const metadata: Metadata = { title: "Prices and budgets" };
export const dynamic = "force-dynamic";

export default async function AnalyticsSettingsPage() {
  const result = await load(() => getAnalyticsSettingsPage());
  return (
    <>
      <PageHeader
        title="Prices and budgets"
        description="Your model price table, how you pay for each tool, and monthly budgets. Used only for estimates on Analytics."
      >
        <Link href="/analytics" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden /> Analytics
        </Link>
      </PageHeader>
      {!result.ok ? (
        <DataUnavailable error={result.error} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Billing and budgets</h2>
              </CardTitle>
              <CardDescription>
                ADCC can&apos;t see your plan or bill, so say how each tool is paid for. A
                subscription has no per-token charge: its estimates are API-equivalent only.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AnalyticsSettingsForm settings={result.data.settings} />
            </CardContent>
          </Card>
          <PriceTable prices={result.data.prices} />
          <UnpricedModels models={result.data.unpricedModels} />
          <Assumptions />
        </>
      )}
    </>
  );
}

const rateFormat = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
});
const rate = (value: number | null) =>
  value === null ? <NotAvailable /> : rateFormat.format(value);

/** Versions of one model, newest first, each with the day before the next one as its end. */
function withEnds(prices: PriceVersion[]) {
  return prices.map((price, i) => {
    const newer = prices[i - 1];
    return { price, until: newer?.model === price.model ? addDays(newer.effectiveFrom, -1) : null };
  });
}

function PriceTable({ prices }: { prices: PriceVersion[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>
            <h2>Model prices</h2>
          </CardTitle>
          <CardDescription>
            USD per million tokens. Add a new version when a price changes; older usage keeps the
            price that applied on its day.
          </CardDescription>
        </div>
        <PriceFormDialog
          trigger={
            <Button>
              <Plus aria-hidden /> Add price
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="px-0">
        {prices.length === 0 ? (
          <div className="px-6">
            <EmptyState
              icon={Tags}
              title="No prices yet"
              description="ADCC ships no prices, so nothing is estimated until you add one from the provider's published price list."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Model</TableHead>
                <TableHead>Applies</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Cache read</TableHead>
                <TableHead className="text-right">Cache write</TableHead>
                <TableHead className="text-right">Reasoning</TableHead>
                <TableHead>Source and assumptions</TableHead>
                <TableHead className="pr-6">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {withEnds(prices).map(({ price, until }) => (
                <TableRow key={price.id}>
                  <TableCell className="pl-6 font-mono text-xs">{price.model}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDay(price.effectiveFrom)} – {until ? formatDay(until) : "now"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate(price.inputPerMTok)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate(price.outputPerMTok)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate(price.cacheReadPerMTok)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate(price.cacheWritePerMTok)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate(price.reasoningPerMTok)}
                  </TableCell>
                  <TableCell className="max-w-72 text-xs">
                    <span className="block break-words">{price.source}</span>
                    {price.notes && (
                      <span className="block text-muted-foreground">{price.notes}</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-6">
                    <div className="flex justify-end gap-1">
                      <PriceFormDialog
                        price={price}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit price for ${price.model} from ${price.effectiveFrom}`}
                          >
                            <Pencil aria-hidden />
                          </Button>
                        }
                      />
                      <DeletePriceButton price={price} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function UnpricedModels({ models }: { models: { model: string; tokens: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Recorded models with no price</h2>
        </CardTitle>
        <CardDescription>
          Usage from these models shows as &ldquo;No price&rdquo;, never as $0.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {models.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every recorded model has at least one price. Usage before a model&apos;s first price, or
            of a kind whose rate is blank, is still unpriced: Analytics lists it under Missing data.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {models.map(({ model, tokens }) => (
              <li
                key={model}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0"
              >
                <span>
                  <span className="font-mono text-xs">{model}</span>
                  <span className="ml-2 text-muted-foreground">
                    {formatNumber(tokens)} tokens recorded
                  </span>
                </span>
                <PriceFormDialog
                  model={model}
                  trigger={
                    <Button variant="outline" size="sm" aria-label={`Add price for ${model}`}>
                      <Plus aria-hidden /> Add price
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Assumptions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>How estimates are made</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            Estimate = each kind of recorded token × its rate, using the price version in force on
            the day the response was recorded (days in {serverTimeZone()}).
          </li>
          <li>
            Token kinds never overlap: input excludes cached input, output excludes reasoning. A
            kind with tokens but no rate leaves that usage unpriced instead of guessing.
          </li>
          <li>
            Model ids must match exactly. A model with no price, or usage before its first price, is
            unpriced and listed under Missing data.
          </li>
          <li>
            Prices are USD, entered by you; ADCC ships none and never fetches them. Discounts, batch
            rates, regional pricing, taxes and credits aren&apos;t modelled.
          </li>
          <li>Billed cost isn&apos;t available: no provider billing source is connected.</li>
        </ul>
      </CardContent>
    </Card>
  );
}
