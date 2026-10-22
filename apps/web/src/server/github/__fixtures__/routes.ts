import { readFileSync } from "node:fs";

// Test fixture: recorded GitHub responses by API path (query strings ignored). Shared by the
// Vitest fetch mock and the e2e mock GitHub server. Read with fs, not `import`, so it loads
// the same under Vitest and Playwright.

const read = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"));

const base = "/repos/octocat/hello-world";

const fixtureRoutes: Record<string, unknown> = {
  "/user": read("user.json"),
  "/rate_limit": read("rate-limit.json"),
  "/user/repos": read("user-repos.json"),
  [base]: read("repo.json"),
  [`${base}/branches`]: read("branches.json"),
  [`${base}/commits`]: read("commits.json"),
  [`${base}/pulls`]: read("pulls.json"),
  [`${base}/issues`]: read("issues.json"),
  [`${base}/actions/runs`]: read("runs.json"),
  [`${base}/pulls/11592/reviews`]: read("reviews-11592.json"),
  [`${base}/pulls/11593/reviews`]: read("reviews-11593.json"),
};

/** GitHub's paths are case-insensitive; so is the mock. */
export function fixtureFor(pathname: string): unknown {
  return fixtureRoutes[pathname.toLowerCase()];
}
