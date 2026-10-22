import { createServer } from "node:http";
import { fixtureFor } from "../src/server/github/__fixtures__/routes";

// A stand-in GitHub API on loopback, serving the recorded fixtures, so e2e never calls the
// real GitHub. playwright.config.ts points the app's GITHUB_API_URL here.
export const GITHUB_MOCK_PORT = 3101;

export default async function startGitHubMock() {
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    // The app may only read GitHub; anything else is a bug the tests should see.
    const body = req.method === "GET" ? fixtureFor(pathname) : undefined;
    const status = req.method !== "GET" ? 405 : body === undefined ? 404 : 200;
    res.writeHead(status, {
      "content-type": "application/json",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4999",
    });
    res.end(
      JSON.stringify(body ?? { message: status === 405 ? "Method not allowed" : "Not Found" }),
    );
  });
  await new Promise<void>((resolve) => server.listen(GITHUB_MOCK_PORT, "127.0.0.1", resolve));
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}
