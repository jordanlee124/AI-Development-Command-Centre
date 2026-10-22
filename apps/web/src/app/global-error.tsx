"use client";

import "./globals.css";

// Replaces the root layout when the layout itself fails, so it renders its own <html> and
// cannot rely on the theme provider: it uses the dark theme directly.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark h-full">
      <body className="flex min-h-full items-center justify-center p-6">
        <main role="alert" className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-xl font-semibold">ADCC failed to start this page</h1>
          <p className="text-sm text-muted-foreground">
            {error.digest
              ? `Server log reference: ${error.digest}.`
              : "See the terminal running the dev server for details."}
          </p>
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
