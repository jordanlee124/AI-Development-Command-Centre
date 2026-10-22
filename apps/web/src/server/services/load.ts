export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

/** Runs a read; a failure (usually the database being down) becomes a value the page renders. */
export async function load<T>(read: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (error) {
    console.error("[load] read failed", error);
    return { ok: false, error: (error instanceof Error ? error.message : String(error)).trim() };
  }
}
