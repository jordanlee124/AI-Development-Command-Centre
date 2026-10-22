"use client";

import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert">
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description={
          error.digest
            ? `This page failed to render. Server log reference: ${error.digest}.`
            : "This page failed to render."
        }
      >
        <Button onClick={reset}>Try again</Button>
      </EmptyState>
    </div>
  );
}
