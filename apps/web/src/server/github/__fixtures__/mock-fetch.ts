import { vi } from "vitest";
import { fixtureFor } from "./routes";

// Test helper: replaces global fetch with the recorded GitHub fixtures. `overrides` maps a path
// to a response factory, to simulate errors, rate limits and outages.

export type Override = (call: number) => Response | Promise<Response>;

export function mockGitHubFetch(overrides: Record<string, Override> = {}) {
  const requests: { url: URL; init: RequestInit }[] = [];
  const counts = new Map<string, number>();
  const fetch = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(input);
    requests.push({ url, init });
    const call = (counts.get(url.pathname) ?? 0) + 1;
    counts.set(url.pathname, call);
    const override = overrides[url.pathname];
    if (override) return override(call);
    const body = fixtureFor(url.pathname);
    return body === undefined
      ? Response.json({ message: "Not Found" }, { status: 404 })
      : Response.json(body);
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, requests };
}
