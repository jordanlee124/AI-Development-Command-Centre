"use client";

import { Trash2 } from "lucide-react";
import { deletePriceAction, savePriceAction } from "@/app/actions/analytics";
import { ActionButton } from "@/components/dashboard/action-button";
import { FormDialog } from "@/components/dashboard/form-dialog";
import { TextareaField, TextField } from "@/components/dashboard/form-fields";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { PriceVersion } from "@/domain/pricing";

const rateText = (rate: number | null | undefined) => (rate == null ? "" : String(rate));

/** Adds a price version, or edits `price`. `model` prefills the model of a new one. */
export function PriceFormDialog({
  price,
  model,
  trigger,
}: {
  price?: PriceVersion;
  model?: string;
  trigger: React.ReactElement;
}) {
  return (
    <FormDialog
      trigger={trigger}
      title={price ? `Edit price for ${price.model}` : "Add a price"}
      description="USD per million tokens, from the provider's published price list. ADCC uses it only to estimate; it never claims you were charged this."
      action={savePriceAction}
      submitLabel={price ? "Save price" : "Add price"}
    >
      {(state) => (
        <>
          {price && <input type="hidden" name="id" value={price.id} />}
          <TextField
            name="model"
            label="Model"
            state={state}
            defaultValue={price?.model ?? model}
            description="Exactly as recorded, e.g. claude-opus-5-5. The Analytics page lists recorded ids."
            className="font-mono"
            required
          />
          <TextField
            name="effectiveFrom"
            label="Effective from"
            type="date"
            state={state}
            defaultValue={price?.effectiveFrom}
            description="Applies from this day until the model's next price."
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="inputPerMTok"
              label="Input"
              inputMode="decimal"
              state={state}
              defaultValue={rateText(price?.inputPerMTok)}
              required
            />
            <TextField
              name="outputPerMTok"
              label="Output"
              inputMode="decimal"
              state={state}
              defaultValue={rateText(price?.outputPerMTok)}
              required
            />
            <TextField
              name="cacheReadPerMTok"
              label="Cache read"
              inputMode="decimal"
              state={state}
              defaultValue={rateText(price?.cacheReadPerMTok)}
              description="Blank if unknown."
            />
            <TextField
              name="cacheWritePerMTok"
              label="Cache write"
              inputMode="decimal"
              state={state}
              defaultValue={rateText(price?.cacheWritePerMTok)}
              description="Blank if unknown."
            />
          </div>
          <TextField
            name="reasoningPerMTok"
            label="Reasoning / thinking"
            inputMode="decimal"
            state={state}
            defaultValue={rateText(price?.reasoningPerMTok)}
            description="Blank if unknown. If the provider bills these as output tokens, enter the output rate."
          />
          <TextField
            name="source"
            label="Source"
            state={state}
            defaultValue={price?.source}
            description="Where the price came from: the pricing page URL and the date you read it."
            required
          />
          <TextareaField
            name="notes"
            label="Assumptions"
            state={state}
            defaultValue={price?.notes ?? ""}
            description="Optional, e.g. which cache-write duration the rate is for."
          />
        </>
      )}
    </FormDialog>
  );
}

export function DeletePriceButton({ price }: { price: PriceVersion }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete price for ${price.model} from ${price.effectiveFrom}`}
          >
            <Trash2 aria-hidden />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this price?</AlertDialogTitle>
          <AlertDialogDescription>
            {price.model} from {price.effectiveFrom}. Usage it covered will be estimated with the
            model&apos;s previous price, or show as unpriced if there is none. No usage data is
            changed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <ActionButton variant="destructive" action={() => deletePriceAction(price.id)}>
            Delete price
          </ActionButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
