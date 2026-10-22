"use client";

import { saveAnalyticsSettingsAction } from "@/app/actions/analytics";
import {
  FormMessage,
  SelectField,
  TextField,
  useFormAction,
} from "@/components/dashboard/form-fields";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { AGENT_SOURCE_LABELS, AGENT_SOURCES } from "@/domain/agent";
import { BILLING_LABELS, type AnalyticsSettings } from "@/domain/analytics";
import { optionsFrom } from "@/lib/options";

const billingOptions = optionsFrom(BILLING_LABELS);

export function AnalyticsSettingsForm({ settings }: { settings: AnalyticsSettings }) {
  const { state, pending, formProps } = useFormAction(saveAnalyticsSettingsAction);
  const { budget } = settings;
  return (
    <form {...formProps} className="flex flex-col gap-6">
      <FieldSet>
        <FieldLegend>How you pay for each tool</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          {AGENT_SOURCES.map((source) => (
            <SelectField
              key={source}
              name={`billing_${source}`}
              label={AGENT_SOURCE_LABELS[source]}
              state={state}
              options={billingOptions}
              defaultValue={settings.billing[source]}
            />
          ))}
        </FieldGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend>Monthly budget</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-3">
          <TextField
            name="monthlyTokens"
            label="Recorded tokens"
            inputMode="numeric"
            state={state}
            defaultValue={budget.monthlyTokens ?? ""}
            description="Blank for no token budget."
          />
          <TextField
            name="monthlyCostUsd"
            label="Estimated cost (USD)"
            inputMode="decimal"
            state={state}
            defaultValue={budget.monthlyCostUsd ?? ""}
            description="API-equivalent estimate, not a bill."
          />
          <TextField
            name="warnPercent"
            label="Warn at (%)"
            inputMode="numeric"
            state={state}
            defaultValue={budget.warnPercent}
            required
          />
        </FieldGroup>
      </FieldSet>
      <FormMessage state={state} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {state?.ok && !pending ? "Saved." : ""}
        </p>
      </div>
    </form>
  );
}
