import { readFileSync } from "node:fs";
import { sessionEventSchema } from "@adcc/shared";
import { describe, expect, it } from "vitest";
import { newTranscriptState, parseTranscriptLines } from "./claude-transcript.ts";
import type { Line } from "./scanner.ts";

function fixtureLines(): Line[] {
  const text = readFileSync(
    new URL("./__fixtures__/claude-session.jsonl", import.meta.url),
    "utf8",
  );
  return text.split("\n").map((line, i) => ({ text: line, lineNo: i + 1 }));
}

describe("parseTranscriptLines on a real, redacted transcript", () => {
  const state = newTranscriptState();
  const { events, skipped } = parseTranscriptLines(fixtureLines(), state);
  const byType = (type: string) => events.filter((e) => e.type === type);

  it("reads the session's folder, branch and title", () => {
    expect(state).toMatchObject({
      cwd: "D:\\Projects\\fixture-app",
      gitBranch: "main",
      title: "Fixture session title",
    });
  });

  it("counts unknown and broken records instead of guessing", () => {
    expect(skipped).toBe(2); // line 13: unknown type, line 14: truncated JSON
  });

  it("stores a response's usage once, though it is repeated on each of its records", () => {
    const messages = byType("message.assistant");
    expect(messages.map((e) => e.externalId)).toEqual([
      "message:msg_011CgEuoAXik3nEfkH1Nu7k4",
      "message:msg_011CgFSuA2jNQTPmtqq6AyV3",
    ]);
    // output_tokens 270 includes 94 thinking tokens: stored disjoint.
    expect(messages[0]).toMatchObject({
      occurredAt: "2026-10-21T06:30:00.778Z",
      sourceLine: 4,
      usage: {
        model: "claude-opus-5-5",
        inputTokens: 2,
        outputTokens: 176,
        reasoningTokens: 94,
        cacheReadTokens: 27527,
        cacheWriteTokens: 24886,
      },
    });
  });

  it("records the user turn but not its text", () => {
    expect(byType("message.user")).toEqual([
      expect.objectContaining({ sourceLine: 2, summary: null, usage: null }),
    ]);
  });

  it("records tool use by name only", () => {
    expect(byType("tool.use").map((e) => [e.summary, e.sourceLine])).toEqual([
      ["Bash", 6],
      ["Bash", 8],
    ]);
  });

  it("names the failing tool and keeps one redacted line of its error", () => {
    expect(byType("tool.error")).toEqual([
      expect.objectContaining({ summary: "Bash: Exit code 1", sourceLine: 9 }),
    ]);
    expect(JSON.stringify(events)).not.toContain("npm_");
  });

  it("records API errors with Claude Code's error code", () => {
    expect(byType("api.error")).toEqual([
      expect.objectContaining({
        code: "rate_limit",
        summary: "You've hit your session limit · resets 2:50pm",
        usage: null,
      }),
    ]);
  });

  it("never emits prompt, response or tool text", () => {
    expect(JSON.stringify(events)).not.toContain("[redacted]");
  });

  it("emits only events the web app's contract accepts", () => {
    for (const event of events) expect(sessionEventSchema.parse(event)).toEqual(event);
  });
});

describe("parseTranscriptLines across reads", () => {
  it("names a tool error whose tool_use came in an earlier read", () => {
    const lines = fixtureLines();
    const state = newTranscriptState();
    parseTranscriptLines(lines.slice(0, 8), state);
    const { events } = parseTranscriptLines(lines.slice(8, 9), state);
    expect(events[0]?.summary).toBe("Bash: Exit code 1");
  });

  it("gives the same events when the same lines are parsed again after a failed send", () => {
    const lines = fixtureLines();
    const state = newTranscriptState();
    const first = parseTranscriptLines(lines, state);
    expect(parseTranscriptLines(lines, state)).toEqual(first);
  });

  it("keeps the folder the session started in when the shell later changes folder", () => {
    const lines = fixtureLines();
    const state = newTranscriptState();
    parseTranscriptLines(lines.slice(0, 4), state);
    const moved = lines[5]!.text.replace(
      "D:\\\\Projects\\\\fixture-app",
      "D:\\\\Projects\\\\fixture-app\\\\apps\\\\web",
    );
    expect(moved).toContain("apps\\\\web");
    parseTranscriptLines([{ text: moved, lineNo: 6 }], state);
    expect(state.cwd).toBe("D:\\Projects\\fixture-app");
  });

  // Shapes seen in real 2.1.x transcripts on the developer's machine.
  it.each<[string, Record<string, unknown>, boolean]>([
    [
      "a typed prompt",
      { origin: { kind: "human" }, content: [{ type: "text", text: "Fix it" }] },
      true,
    ],
    [
      "a prompt that starts with a tag",
      { origin: { kind: "human" }, content: "<system-reminder>…</system-reminder>Implement it" },
      true,
    ],
    ["a prompt from a version without origin", { content: "Fix it" }, true],
    [
      "a task notification",
      { origin: { kind: "task-notification" }, content: "<task-notification>" },
      false,
    ],
    ["a command echo without origin", { content: "<local-command-stdout>ok" }, false],
    [
      "an interrupt marker",
      { content: [{ type: "text", text: "[Request interrupted by user]" }] },
      false,
    ],
    [
      "a compaction summary",
      { content: "This session is being continued…", isCompactSummary: true },
      false,
    ],
    ["a meta record", { origin: { kind: "peer" }, content: "report", isMeta: true }, false],
  ])("%s → prompt: %s", (_, { content, ...fields }, isPrompt) => {
    const record = JSON.stringify({
      type: "user",
      uuid: "u1",
      timestamp: "2026-10-21T06:30:00.000Z",
      ...fields,
      message: { role: "user", content },
    });
    const { events, skipped } = parseTranscriptLines(
      [{ text: record, lineNo: 1 }],
      newTranscriptState(),
    );
    expect(skipped).toBe(0);
    expect(events.map((e) => e.type)).toEqual(isPrompt ? ["message.user"] : []);
  });

  it("redacts the AI title, which is generated from the conversation", () => {
    const state = newTranscriptState();
    const record = JSON.stringify({ type: "ai-title", aiTitle: "Fix login with password=hunter2" });
    parseTranscriptLines([{ text: record, lineNo: 1 }], state);
    expect(state.title).toBe("Fix login with password=[redacted]");
  });

  it("skips meta user records such as injected reminders", () => {
    const meta = JSON.stringify({
      type: "user",
      isMeta: true,
      uuid: "u1",
      timestamp: "2026-10-21T06:30:00.000Z",
      message: { role: "user", content: "x" },
    });
    expect(parseTranscriptLines([{ text: meta, lineNo: 1 }], newTranscriptState())).toEqual({
      events: [],
      skipped: 0,
    });
  });
});
