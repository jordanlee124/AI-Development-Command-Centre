// Codex rollout parser (<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl), written by
// the Codex desktop app, IDE extension and CLI. Checked against Codex 0.162 files (ADR-018).
// The format is undocumented and differs from Claude Code's, so every record is checked with a
// loose Zod schema; what doesn't match is counted, never guessed at. Only metadata comes out: no
// prompt, response, reasoning, command, patch or tool output text.
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SessionBatch, SessionEvent, TokenUsage } from "@adcc/shared";
import { z } from "zod";
import { redact } from "./redact.ts";
import { code, type Line, type Provider } from "./scanner.ts";

interface HeldUsage {
  externalId: string;
  occurredAt: string;
  sourceLine: number;
  usage: Omit<TokenUsage, "model">;
}

export interface RolloutState {
  /**
   * Set by the file's first session_meta, even one that fails validation: later ones are copied
   * from a parent thread and must never stand in for this session.
   */
  metaSeen: boolean;
  /** From the file's first session_meta, when it was valid. */
  meta: {
    sessionId: string;
    cwd: string;
    gitBranch: string | null;
    details: SessionBatch["details"];
  } | null;
  /** turn id → model, from turn_context records. */
  turnModels: Map<string, string>;
  /**
   * Usage written before its turn's turn_context (a compaction at the start of a turn), held
   * until the model is known. Kept after release so re-parsing after a failed send repeats it.
   */
  held: Map<string, HeldUsage[]>;
}

export function newRolloutState(): RolloutState {
  return { metaSeen: false, meta: null, turnModels: new Map(), held: new Map() };
}

// Codex clients write two styles (both seen in 0.162): the desktop app records prompts and
// operations as item_completed events; the VS Code extension writes user_message,
// patch_apply_end and mcp_tool_call_end events instead. Both write the model's tool calls as response_items. Each
// style's records are read; none is written twice for one thing.

// Records that carry nothing ADCC shows. Ignored, not counted as skipped.
const IGNORED_TYPES = new Set([
  "compacted", // the ContextCompaction item marks the same thing
  "world_state",
  "inter_agent_communication_metadata",
]);
const IGNORED_EVENTS = new Set([
  "agent_message",
  "task_started",
  "thread_settings_applied",
  "token_count", // running totals; token_usage_record has each response's own usage
]);
/** Model input/output text; only tool calls are read from response_items. */
const TOOL_CALLS = new Set(["custom_tool_call", "function_call"]);
const IGNORED_ITEMS = new Set([
  "AgentMessage",
  "Reasoning",
  "Extension",
  "SubAgentActivity",
  "ImageView",
]);
/** Operation item type → the name shown in ADCC (MCP calls get their server and tool). */
const TOOL_ITEMS: Record<string, string> = {
  CommandExecution: "shell",
  FileChange: "apply_patch",
  WebSearch: "web_search",
};

const timestamp = z.iso.datetime({ offset: true });
const id = z.string().regex(/^[\w-]{1,200}$/);
const str = (max: number) => z.string().max(max);

const recordSchema = z.looseObject({
  timestamp,
  type: z.string(),
  payload: z.looseObject({}),
});

const sourceSchema = z.union([
  z.string(),
  z.looseObject({
    subagent: z.union([
      z.string(),
      z.looseObject({
        other: z.string().optional(),
        thread_spawn: z
          .looseObject({ agent_nickname: z.string().nullish(), agent_role: z.string().nullish() })
          .optional(),
      }),
    ]),
  }),
]);

const metaSchema = z.looseObject({
  id,
  cwd: str(1000),
  originator: str(100).optional(),
  cli_version: str(100).optional(),
  model_provider: str(100).optional(),
  forked_from_id: id.nullish(),
  source: z.unknown(),
  git: z.looseObject({ branch: str(255).nullish() }).nullish(),
});

const turnContextSchema = z.looseObject({ turn_id: id, model: z.string().min(1).max(200) });

const count = z.number().int().min(0);
const usageRecordSchema = z.looseObject({
  thread_id: id,
  turn_id: id,
  response_id: z.string().min(1).max(190),
  usage: z.looseObject({
    input_tokens: count,
    cached_input_tokens: count.optional(),
    cache_write_input_tokens: count.optional(),
    output_tokens: count,
    reasoning_output_tokens: count.optional(),
  }),
});

const itemSchema = z.looseObject({
  turn_id: id,
  item: z.looseObject({
    type: z.string(),
    id: z.string().min(1).max(150),
    status: z.string().optional(),
    exit_code: z.number().int().nullish(),
    server: str(100).optional(),
    tool: str(100).optional(),
  }),
});

const toolCallSchema = z.looseObject({
  call_id: z.string().min(1).max(150),
  name: z.string().min(1).max(100),
  namespace: str(100).nullish(),
});

const patchSchema = z.looseObject({ call_id: z.string().min(1).max(150), success: z.boolean() });

const mcpEndSchema = z.looseObject({
  call_id: z.string().min(1).max(150),
  invocation: z.looseObject({ server: str(100), tool: str(100) }),
  // Rust's Result: { Ok: … } or { Err: … }. Only which one is read.
  result: z.union([z.looseObject({ Ok: z.unknown() }), z.looseObject({ Err: z.unknown() })]),
});

const taskCompleteSchema = z.looseObject({
  turn_id: id,
  error: z.looseObject({ message: z.string(), codex_error_info: z.unknown() }).nullish(),
});

const turnAbortedSchema = z.looseObject({ turn_id: id, reason: str(100).optional() });

function detailsOf(meta: z.infer<typeof metaSchema>): SessionBatch["details"] {
  const details: SessionBatch["details"] = [];
  const add = (label: string, value: string | null | undefined) => {
    // Written by Codex, not the user, but cleaned like any other free text.
    const clean = value ? redact(value, 300) : "";
    if (clean) details.push({ label, value: clean });
  };
  add("Client", meta.originator);
  add("Codex version", meta.cli_version);
  add("Model provider", meta.model_provider);
  const parsed = sourceSchema.safeParse(meta.source);
  const source = parsed.success ? parsed.data : null;
  if (typeof source === "string") {
    add("Started from", source);
  } else if (source) {
    const sub = source.subagent;
    const spawn = typeof sub === "string" ? undefined : sub.thread_spawn;
    add(
      "Subagent",
      typeof sub === "string"
        ? sub
        : spawn
          ? [spawn.agent_nickname, spawn.agent_role && `(${spawn.agent_role})`]
              .filter(Boolean)
              .join(" ")
          : sub.other,
    );
  }
  // An id, already checked by the schema; redact would mask it as an opaque string.
  if (meta.forked_from_id) details.push({ label: "Forked from", value: meta.forked_from_id });
  return details;
}

/**
 * OpenAI counts cached input inside input_tokens and reasoning inside output_tokens; split
 * them out so the counts are disjoint (TokenTotals in apps/web/src/domain/agent.ts).
 * shortcut: cache_write_input_tokens is treated like cached input (part of input_tokens). It
 * was 0 in every record checked, so that's unverified; recheck when a non-zero value appears.
 */
function usageOf(u: z.infer<typeof usageRecordSchema>["usage"]): HeldUsage["usage"] {
  const cacheRead = Math.min(u.cached_input_tokens ?? 0, u.input_tokens);
  const cacheWrite = Math.min(u.cache_write_input_tokens ?? 0, u.input_tokens - cacheRead);
  const reasoning = Math.min(u.reasoning_output_tokens ?? 0, u.output_tokens);
  return {
    inputTokens: u.input_tokens - cacheRead - cacheWrite,
    outputTokens: u.output_tokens - reasoning,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: reasoning,
  };
}

function usageEvent(held: HeldUsage, model: string): SessionEvent {
  return {
    externalId: held.externalId,
    type: "message.assistant",
    occurredAt: held.occurredAt,
    sourceLine: held.sourceLine,
    summary: null,
    code: null,
    usage: { model, ...held.usage },
  };
}

/** One record → its events. null means "not understood" (counted as skipped). */
function parseRecord(raw: unknown, lineNo: number, state: RolloutState): SessionEvent[] | null {
  const record = recordSchema.safeParse(raw);
  if (!record.success) return null;
  const { type, payload, timestamp: at } = record.data;
  if (IGNORED_TYPES.has(type)) return [];

  const event = (
    fields: Partial<SessionEvent> & Pick<SessionEvent, "externalId" | "type">,
  ): SessionEvent => ({
    occurredAt: at,
    sourceLine: lineNo,
    summary: null,
    code: null,
    usage: null,
    ...fields,
  });

  if (type === "session_meta") {
    if (state.metaSeen) return []; // a parent thread's, copied into a fork
    state.metaSeen = true;
    const meta = metaSchema.safeParse(payload);
    if (!meta.success) return null;
    state.meta = {
      sessionId: meta.data.id,
      cwd: meta.data.cwd,
      gitBranch: meta.data.git?.branch ?? null,
      details: detailsOf(meta.data),
    };
    return [];
  }

  if (type === "turn_context") {
    const turn = turnContextSchema.safeParse(payload);
    if (!turn.success) return null;
    state.turnModels.set(turn.data.turn_id, turn.data.model);
    return (state.held.get(turn.data.turn_id) ?? []).map((h) => usageEvent(h, turn.data.model));
  }

  if (type === "token_usage_record") {
    const record = usageRecordSchema.safeParse(payload);
    if (!record.success || !state.meta) return null;
    // A fork or subagent file starts with a copy of its parent's history, usage included. That
    // usage belongs to (and is counted with) the parent thread.
    if (record.data.thread_id !== state.meta.sessionId) return [];
    const held: HeldUsage = {
      externalId: `response:${record.data.response_id}`,
      occurredAt: at,
      sourceLine: lineNo,
      usage: usageOf(record.data.usage),
    };
    const model = state.turnModels.get(record.data.turn_id);
    if (model) return [usageEvent(held, model)];
    const list = state.held.get(record.data.turn_id) ?? [];
    if (!list.some((h) => h.externalId === held.externalId)) list.push(held);
    state.held.set(record.data.turn_id, list);
    return [];
  }

  /**
   * A command, edit, MCP call or search that ran. Items and patch_apply_end share the exec-…
   * id, so one operation can't count twice. Failures keep no output text: only the tool and,
   * for commands, the exit code.
   */
  const operation = (
    opId: string,
    tool: string,
    outcome: "completed" | "failed" | "other",
    exit?: number | null,
  ): SessionEvent[] =>
    outcome === "failed"
      ? [
          event({
            externalId: `op:${opId}:error`,
            type: "tool.error",
            summary: `${tool}: ${typeof exit === "number" ? `exit code ${exit}` : "failed"}`,
          }),
        ]
      : outcome === "completed"
        ? [event({ externalId: `op:${opId}`, type: "operation.completed", summary: tool })]
        : []; // declined, still running…: neither a success nor a failure

  const kind = typeof payload.type === "string" ? payload.type : "";

  if (type === "response_item") {
    if (!TOOL_CALLS.has(kind)) return [];
    const call = toolCallSchema.safeParse(payload);
    if (!call.success) return null;
    const { call_id: callId, name, namespace } = call.data;
    return [
      event({
        externalId: `call:${callId}`,
        type: "tool.use",
        summary: namespace ? `${namespace}.${name}` : name,
      }),
    ];
  }

  if (type !== "event_msg") return null;
  if (IGNORED_EVENTS.has(kind)) return [];

  // No id in the record; the line is stable because the file is only appended to.
  if (kind === "user_message")
    return [event({ externalId: `user:${lineNo}`, type: "message.user" })];

  if (kind === "patch_apply_end") {
    const patch = patchSchema.safeParse(payload);
    if (!patch.success) return null;
    return operation(
      patch.data.call_id,
      "apply_patch",
      patch.data.success ? "completed" : "failed",
    );
  }

  if (kind === "mcp_tool_call_end") {
    const call = mcpEndSchema.safeParse(payload);
    if (!call.success) return null;
    const { server, tool } = call.data.invocation;
    const failed = "Err" in call.data.result;
    return operation(call.data.call_id, `mcp:${server}/${tool}`, failed ? "failed" : "completed");
  }

  if (kind === "item_completed") {
    const parsed = itemSchema.safeParse(payload);
    if (!parsed.success) return null;
    const { turn_id: turn, item } = parsed.data;
    const key = `item:${turn}:${item.id}`;
    if (IGNORED_ITEMS.has(item.type)) return [];
    if (item.type === "UserMessage") return [event({ externalId: key, type: "message.user" })];
    if (item.type === "ContextCompaction") {
      return [event({ externalId: key, type: "session.compacted" })];
    }
    const tool =
      item.type === "McpToolCall"
        ? `mcp:${item.server ?? "?"}/${item.tool ?? "?"}`
        : TOOL_ITEMS[item.type];
    if (!tool) return null;
    // Search items carry no status; recorded as completed is all they say.
    const outcome =
      item.status === undefined || item.status === "completed"
        ? "completed"
        : item.status === "failed"
          ? "failed"
          : "other";
    return operation(item.id, tool, outcome, item.exit_code);
  }

  if (kind === "task_complete") {
    const done = taskCompleteSchema.safeParse(payload);
    if (!done.success) return null;
    const { turn_id: turn, error } = done.data;
    if (!error) return [event({ externalId: `turn:${turn}:completed`, type: "turn.completed" })];
    const info = error.codex_error_info;
    return [
      event({
        externalId: `turn:${turn}:error`,
        type: "api.error",
        summary: redact(error.message) || "Turn failed",
        code: typeof info === "string" ? info.slice(0, 100) : null,
      }),
    ];
  }

  if (kind === "turn_aborted") {
    const aborted = turnAbortedSchema.safeParse(payload);
    if (!aborted.success) return null;
    return [
      event({
        externalId: `turn:${aborted.data.turn_id}:aborted`,
        type: "turn.aborted",
        code: aborted.data.reason ?? null,
      }),
    ];
  }

  return null;
}

/** Parses complete lines, updating `state`; safe to repeat after a failed send. */
export function parseRolloutLines(
  lines: readonly Line[],
  state: RolloutState,
): { events: SessionEvent[]; skipped: number } {
  const events = new Map<string, SessionEvent>();
  let skipped = 0;
  for (const { text, lineNo } of lines) {
    if (text.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      skipped++;
      continue;
    }
    const parsed = parseRecord(raw, lineNo, state);
    if (parsed === null) {
      skipped++;
      continue;
    }
    for (const e of parsed) if (!events.has(e.externalId)) events.set(e.externalId, e);
  }
  return { events: [...events.values()], skipped };
}

const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const indexLineSchema = z.looseObject({ id, thread_name: z.string() });

/**
 * Thread names from <CODEX_HOME>/session_index.jsonl. Append-only: a rename adds a line, so the
 * last one per id wins. Names come from the conversation, so they're redacted like titles.
 */
export function parseSessionIndex(text: string): Map<string, string> {
  const titles = new Map<string, string>();
  for (const line of text.split("\n")) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = indexLineSchema.safeParse(raw);
    const title = entry.success ? redact(entry.data.thread_name, 300) : "";
    if (entry.success && title) titles.set(entry.data.id, title);
  }
  return titles;
}

const YEAR = /^\d{4}$/;
const MONTH_OR_DAY = /^\d{2}$/;
const ROLLOUT_FILE = /^rollout-[\w-]{1,200}\.jsonl$/;

/**
 * Read access: `<CODEX_HOME>/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl` and
 * `<CODEX_HOME>/session_index.jsonl`, nothing else. File names don't say which folder a session
 * ran in, so every rollout is opened; one outside the approved folders is dropped after at most
 * its first 1 MB (the scanner's limit until a file names its folder) and never read again.
 * shortcut: a title is sent with a session's next new records, so renaming a thread that's
 * already caught up shows after its next turn (or a bridge restart).
 */
export function codexProvider(codexHome: string): Provider {
  const sessionsDir = join(codexHome, "sessions");
  const indexPath = join(codexHome, "session_index.jsonl");
  let titles = new Map<string, string>();

  async function list(dir: string, pattern: RegExp, errors: string[], dirs: boolean) {
    try {
      return (await readdir(dir, { withFileTypes: true }))
        .filter((e) => (dirs ? e.isDirectory() : e.isFile()) && pattern.test(e.name))
        .map((e) => join(dir, e.name));
    } catch (error) {
      errors.push(`Can't read ${dir}: ${code(error)}`);
      return [];
    }
  }

  return {
    source: "CODEX",
    dataDir: sessionsDir,
    async listFiles() {
      const errors: string[] = [];
      try {
        await readdir(sessionsDir);
      } catch (error) {
        return {
          files: [],
          errors: [`Can't read the Codex sessions folder ${sessionsDir}: ${code(error)}`],
        };
      }
      const files: string[] = [];
      for (const year of await list(sessionsDir, YEAR, errors, true)) {
        for (const month of await list(year, MONTH_OR_DAY, errors, true)) {
          for (const day of await list(month, MONTH_OR_DAY, errors, true)) {
            files.push(...(await list(day, ROLLOUT_FILE, errors, false)));
          }
        }
      }
      try {
        const { size } = await stat(indexPath);
        if (size > MAX_INDEX_BYTES) errors.push(`${indexPath} is too large; titles skipped`);
        else titles = parseSessionIndex(await readFile(indexPath, "utf8"));
      } catch (error) {
        // No index yet just means no titles.
        if (code(error) !== "ENOENT") errors.push(`Can't read ${indexPath}: ${code(error)}`);
      }
      return { files, errors };
    },
    newParser() {
      const state = newRolloutState();
      return {
        parse: (lines) => parseRolloutLines(lines, state),
        session: () => ({
          sessionId: state.meta?.sessionId ?? null,
          cwd: state.meta?.cwd ?? null,
          gitBranch: state.meta?.gitBranch ?? null,
          title: (state.meta && titles.get(state.meta.sessionId)) ?? null,
          details: state.meta?.details ?? [],
        }),
      };
    },
  };
}
