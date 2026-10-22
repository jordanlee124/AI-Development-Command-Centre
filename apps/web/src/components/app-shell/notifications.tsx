"use client";

import { useEffect, useState } from "react";
import { Bell, CircleAlert, CircleCheck } from "lucide-react";
import type { HealthReport } from "@/domain/health";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

type State = { kind: "loading" } | { kind: "loaded"; report: HealthReport } | { kind: "error" };

async function fetchHealth(): Promise<State> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    return { kind: "loaded", report: (await response.json()) as HealthReport };
  } catch {
    return { kind: "error" };
  }
}

/** System notices derived from the live health check, the only real event source so far. */
export function Notifications() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void fetchHealth().then((next) => !cancelled && setState(next));
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = () => void fetchHealth().then(setState);

  const problems =
    state.kind === "loaded" ? state.report.checks.filter((check) => check.status === "down") : [];
  const alertCount = state.kind === "error" ? 1 : problems.length;

  return (
    <Popover onOpenChange={(open) => open && refresh()}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={alertCount ? `Notifications (${alertCount} alerts)` : "Notifications"}
            className="relative"
          />
        }
      >
        <Bell aria-hidden />
        {alertCount > 0 && (
          <span
            aria-hidden
            className="absolute top-1 right-1 size-2 rounded-full bg-destructive ring-2 ring-background"
          />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Notifications</PopoverTitle>
          <PopoverDescription>System status for this machine.</PopoverDescription>
        </PopoverHeader>
        <ul className="flex flex-col gap-2 text-sm" aria-live="polite">
          {state.kind === "loading" && <li className="text-muted-foreground">Checking…</li>}
          {state.kind === "error" && (
            <li className="flex gap-2">
              <CircleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
              Could not reach the dashboard server.
            </li>
          )}
          {state.kind === "loaded" && problems.length === 0 && (
            <li className="flex gap-2 text-muted-foreground">
              <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
              All systems operational.
            </li>
          )}
          {problems.map((check) => (
            <li key={check.name} className="flex gap-2">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>
                <span className="font-medium capitalize">{check.name} unavailable.</span>{" "}
                <span className="text-muted-foreground">See Settings → System for details.</span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
