import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The bridge is read-only by construction (ADR-017). These checks fail the build if someone adds
// a way to run commands, write files or listen for connections.
const sources = readdirSync(new URL(".", import.meta.url))
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => ({ name, text: readFileSync(new URL(name, import.meta.url), "utf8") }));

describe("bridge source", () => {
  it("launches processes only in claude-live.ts, with execFile and no shell", () => {
    const launching = sources.filter((s) =>
      /child_process|node:cluster|worker_threads/.test(s.text),
    );
    expect(launching.map((s) => s.name)).toEqual(["claude-live.ts"]);
    const live = launching[0]!.text;
    expect(live).not.toMatch(/\b(exec|spawn|execSync|spawnSync|fork)\(/);
    expect(live).toContain("shell: false");
    expect(live).toContain('const ARGS = ["agents", "--json"] as const;');
  });

  it("writes no files and opens no ports", () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(
        /\b(writeFile|appendFile|createWriteStream|rm|rmdir|unlink|rename|mkdir|copyFile|truncate)\w*\(/,
      );
      expect(text, name).not.toMatch(/\b(createServer|listen)\(/);
      expect(text, name).not.toMatch(/open\([^)]*,\s*["'](?!r["'])/); // fs open only with "r"
    }
  });
});
