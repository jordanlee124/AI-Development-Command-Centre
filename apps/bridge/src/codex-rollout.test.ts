import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionEventSchema } from "@adcc/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  codexProvider,
  newRolloutState,
  parseRolloutLines,
  parseSessionIndex,
} from "./codex-rollout.ts";
import { TranscriptScanner, type Line } from "./scanner.ts";

const FIXTURE = readFileSync(
  new URL("./__fixtures__/codex-session.jsonl", import.meta.url),
  "utf8",
);
const SESSION = "01a160e9-0000-7000-8000-00000000f107";
const lines: Line[] = FIXTURE.split("\n")
  .slice(0, -1)
  .map((text, i) => ({ text, lineNo: i + 1 }));

function parseAll() {
  const state = newRolloutState();
  return { state, ...parseRolloutLines(lines, state) };
}

describe("parseRolloutLines", () => {
  it("reads session metadata from the first session_meta only", () => {
    const { state } = parseAll();
    expect(state.meta).toEqual({
      sessionId: SESSION,
      cwd: "D:\\Projects\\fixture-app",
      gitBranch: "main",
      details: [
        { label: "Client", value: "Codex Desktop" },
        { label: "Codex version", value: "0.162.0-alpha.17.2" },
        { label: "Model provider", value: "openai" },
        { label: "Started from", value: "vscode" },
      ],
    });
  });

  it("produces valid events, and counts the unknown record and the broken line", () => {
    const { events, skipped } = parseAll();
    for (const event of events) expect(sessionEventSchema.parse(event)).toEqual(event);
    expect(skipped).toBe(2);
    expect(events.map((e) => [e.sourceLine, e.type, e.summary, e.code])).toEqual([
      // Desktop style: prompt and operations as items, the model's calls as response_items.
      [5, "message.user", null, null],
      [6, "tool.use", "exec", null],
      [8, "message.assistant", null, null],
      [9, "operation.completed", "shell", null],
      [10, "tool.error", "shell: exit code 1", null],
      [11, "operation.completed", "apply_patch", null],
      [12, "tool.error", "mcp:codex_app/read_thread: failed", null],
      [14, "tool.use", "collaboration.spawn_agent", null],
      [15, "message.assistant", null, null],
      [17, "turn.completed", null, null],
      // Usage from line 19, held until its turn's model arrived on line 21.
      [19, "message.assistant", null, null],
      [22, "session.compacted", null, null],
      [23, "turn.aborted", null, "interrupted"],
      // VS Code style: prompt and edit as events. Line 28 repeats line 11's edit: not counted.
      [26, "message.user", null, null],
      [27, "operation.completed", "apply_patch", null],
      [29, "operation.completed", "mcp:codex_apps/github.get_repo", null],
      [
        30,
        "api.error",
        "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro) or try again at 3:02 PM.",
        "usage_limit_exceeded",
      ],
    ]);
  });

  it("splits cached input and reasoning out so token counts are disjoint", () => {
    const usage = parseAll().events.flatMap((e) => (e.usage ? [[e.externalId, e.usage]] : []));
    expect(usage).toEqual([
      [
        "response:resp_fixture_01",
        {
          model: "gpt-6.1-sol",
          inputTokens: 48637 - 39168,
          cacheReadTokens: 39168,
          cacheWriteTokens: 0,
          outputTokens: 136 - 9,
          reasoningTokens: 9,
        },
      ],
      [
        "response:resp_fixture_02",
        {
          model: "gpt-6.1-sol",
          inputTokens: 53892 - 48512,
          cacheReadTokens: 48512,
          cacheWriteTokens: 0,
          outputTokens: 279 - 12,
          reasoningTokens: 12,
        },
      ],
      [
        "response:resp_fixture_03",
        {
          model: "gpt-6-astra",
          inputTokens: 56765 - 54912,
          cacheReadTokens: 54912,
          cacheWriteTokens: 0,
          outputTokens: 98 - 28,
          reasoningTokens: 28,
        },
      ],
    ]);
  });

  it("ignores usage copied from a parent thread", () => {
    const ids = parseAll().events.map((e) => e.externalId);
    expect(ids).not.toContain("response:resp_fixture_parent");
  });

  it("gives the same events when read in chunks, and again after a failed send", () => {
    const state = newRolloutState();
    const first = parseRolloutLines(lines.slice(0, 20), state);
    const rest = parseRolloutLines(lines.slice(20), state);
    const retry = parseRolloutLines(lines.slice(20), state);
    // Across chunks, a repeat (line 28) is dropped by the database's unique externalId instead.
    const stored = new Map(
      [...first.events, ...rest.events].map((e) => [e.externalId, e] as const).reverse(),
    );
    expect([...stored.values()].sort((a, b) => a.sourceLine - b.sourceLine)).toEqual(
      parseAll().events,
    );
    expect(retry).toEqual(rest);
  });

  it("never lets a parent's copied session_meta stand in for an invalid first one", () => {
    const state = newRolloutState();
    const meta = (payload: object, lineNo: number) => ({
      text: JSON.stringify({
        timestamp: "2026-10-22T00:00:00.000Z",
        type: "session_meta",
        payload,
      }),
      lineNo,
    });
    const result = parseRolloutLines(
      [
        meta({ id: "../bad", cwd: "D:\\Projects" }, 1),
        meta({ id: SESSION, cwd: "D:\\Projects" }, 2),
      ],
      state,
    );
    expect(result.skipped).toBe(1);
    expect(state.meta).toBeNull(); // so the file is never sent
  });

  it("counts an operation as completed or failed only when it says so", () => {
    const state = newRolloutState();
    const item = (status: string, lineNo: number) => ({
      text: JSON.stringify({
        timestamp: "2026-10-22T00:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "item_completed",
          turn_id: "t1",
          item: { type: "CommandExecution", id: `exec-${lineNo}`, status, exit_code: 1 },
        },
      }),
      lineNo,
    });
    const { events } = parseRolloutLines([item("declined", 1), item("failed", 2)], state);
    expect(events.map((e) => [e.type, e.summary])).toEqual([["tool.error", "shell: exit code 1"]]);
  });

  it("names a subagent and the thread it was forked from", () => {
    const state = newRolloutState();
    const meta = {
      timestamp: "2026-10-22T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: SESSION,
        cwd: "D:\\Projects\\fixture-app",
        forked_from_id: "01a160e9-0000-7000-8000-0000000000aa",
        source: {
          subagent: { thread_spawn: { agent_nickname: "Averroes", agent_role: "worker" } },
        },
      },
    };
    parseRolloutLines([{ text: JSON.stringify(meta), lineNo: 1 }], state);
    expect(state.meta?.details).toEqual([
      { label: "Subagent", value: "Averroes (worker)" },
      { label: "Forked from", value: "01a160e9-0000-7000-8000-0000000000aa" },
    ]);
  });

  it("never lets prompt, command, patch or tool output text through", () => {
    const text = JSON.stringify(parseAll().events);
    expect(text).not.toContain("[redacted]");
  });
});

describe("parseSessionIndex", () => {
  it("keeps the latest name per thread, redacted, and skips bad lines", () => {
    const index = [
      { id: "a", thread_name: "First name" },
      { id: "b", thread_name: "Set token=abc123def456 for the API" },
      { id: "a", thread_name: "Renamed" },
    ]
      .map((entry) => JSON.stringify(entry))
      .concat(["{broken", JSON.stringify({ id: "../x", thread_name: "bad id" })])
      .join("\n");
    expect(Object.fromEntries(parseSessionIndex(index))).toEqual({
      a: "Renamed",
      b: "Set token=[redacted] for the API",
    });
  });
});

describe("codexProvider", () => {
  let home: string;
  let day: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "adcc-codex-"));
    day = join(home, "sessions", "2026", "10", "22");
    mkdirSync(day, { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("lists only rollout files in dated folders", async () => {
    writeFileSync(join(day, `rollout-2026-10-22T11-01-23-${SESSION}.jsonl`), FIXTURE);
    writeFileSync(join(day, "notes.txt"), "");
    mkdirSync(join(home, "sessions", "misc"));
    writeFileSync(join(home, "sessions", "misc", "rollout-x.jsonl"), "");
    const { files, errors } = await codexProvider(home).listFiles();
    expect(files).toEqual([join(day, `rollout-2026-10-22T11-01-23-${SESSION}.jsonl`)]);
    expect(errors).toEqual([]);
  });

  it("sends an approved session as Codex, with its title from the session index", async () => {
    const file = join(day, `rollout-2026-10-22T11-01-23-${SESSION}.jsonl`);
    writeFileSync(file, FIXTURE);
    writeFileSync(
      join(home, "session_index.jsonl"),
      `${JSON.stringify({ id: SESSION, thread_name: "Fixture thread" })}\n`,
    );
    const scanner = new TranscriptScanner(codexProvider(home), ["D:\\Projects"]);
    await scanner.listFiles();
    const read = await scanner.read(file);
    expect(read?.batches[0]).toMatchObject({
      source: "CODEX",
      sessionId: SESSION,
      sourcePath: file,
      cwd: "D:\\Projects\\fixture-app",
      gitBranch: "main",
      title: "Fixture thread",
      skippedRecords: 2,
    });
    expect(read?.batches[0]?.events).toHaveLength(17);
  });

  it("never sends a session from outside the approved folders", async () => {
    const file = join(day, `rollout-2026-10-22T11-01-23-${SESSION}.jsonl`);
    writeFileSync(file, FIXTURE);
    const scanner = new TranscriptScanner(codexProvider(home), ["C:\\Work"]);
    expect(await scanner.read(file)).toBeNull();
  });

  it("reports a missing sessions folder", async () => {
    const { files, errors } = await codexProvider(join(home, "missing")).listFiles();
    expect(files).toEqual([]);
    expect(errors[0]).toMatch(/Can't read the Codex sessions folder .*ENOENT/);
  });
});
