import { DatabaseZap } from "lucide-react";
import { EmptyState } from "./empty-state";

/** Shown when a page's read failed. Says so plainly instead of rendering zeros. */
export function DataUnavailable({
  error,
  title = "Data unavailable",
  description = "The database could not be reached, so nothing on this page can be shown. Start Postgres (pnpm db:up), then reload.",
}: {
  error: string;
  title?: string;
  description?: string;
}) {
  return (
    <div role="alert">
      <EmptyState
        icon={DatabaseZap}
        title={title}
        description={description}
        className="border-destructive/40"
      >
        <details className="w-full max-w-xl text-left text-xs text-muted-foreground">
          <summary className="cursor-pointer">Error details</summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 whitespace-pre-wrap">
            {error}
          </pre>
        </details>
      </EmptyState>
    </div>
  );
}
