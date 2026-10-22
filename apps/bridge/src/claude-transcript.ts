// Claude Code transcript parser (~/.claude/projects/<folder>/<session-id>.jsonl).
// The docs call this format internal and say it changes between versions (ADR-017), so every
// record is checked with a loose Zod schema; what doesn't match is counted, never guessed at.
// Only metadata comes out: no prompt, response, tool input or tool output text.
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SessionEvent } from "@adcc/shared";
import { z } from "zod";
import { redact } from "./redact.ts";
import { code, type Line, type Provider } from "./scanner.ts";

export interface TranscriptState {
  /** tool_use id → tool name, so a later tool_result error can name its tool. */
  toolNames: Map<string, string>;
  /** First recorded working folder: where the session started. */
  cwd: string | null;
  gitBranch: string | null;
  title: string | null;
}

export function newTranscriptState(): TranscriptState {
  return { toolNames: new Map(), cwd: null, gitBranch: null, title: null };
}

// Records that carry nothing ADCC shows: UI/state bookkeeping. Ignored, not counted as skipped.
const IGNORED_TYPES = new Set([
  "attachment",
  "file-history-snapshot",
  "file-history-delta",
  "queue-operation",
  "atis-latch",
  "last-prompt",
  "api-request",
  "api-request-shape",
  "api-request-blob",
  "mode",
  "cost-state",
  "summary",
  "progress",
]);

const timestamp = z.iso.datetime({ offset: true });
const block = z.looseObject({ type: z.string() });

const baseSchema = z.looseObject({
  type: z.string(),
  cwd: z.string().max(1000).optional(),
  gitBranch: z.string().max(255).optional(),
});

const userSchema = z.looseObject({
  uuid: z.string().max(200),
  timestamp,
  isMeta: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  origin: z.looseObject({ kind: z.string() }).optional(),
  message: z.looseObject({ content: z.union([z.string(), z.array(block)]) }),
});

const toolResultSchema = z.looseObject({
  type: z.literal("tool_result"),
  tool_use_id: z.string().max(200),
  is_error: z.boolean().optional(),
  content: z
    .union([z.string(), z.array(z.looseObject({ type: z.string(), text: z.string().optional() }))])
    .optional(),
});

const count = z.number().int().min(0).nullish();
const usageSchema = z.looseObject({
  input_tokens: count,
  output_tokens: count,
  cache_read_input_tokens: count,
  cache_creation_input_tokens: count,
  output_tokens_details: z.looseObject({ thinking_tokens: count }).nullish(),
});

const assistantSchema = z.looseObject({
  uuid: z.string().max(200),
  timestamp,
  isApiErrorMessage: z.boolean().optional(),
  error: z.string().max(100).optional(),
  message: z.looseObject({
    id: z.string().max(190).optional(),
    model: z.string().max(200).optional(),
    content: z.array(block),
    usage: usageSchema.nullish(),
  }),
});

const toolUseSchema = z.looseObject({
  type: z.literal("tool_use"),
  id: z.string().max(200),
  name: z.string().max(200),
});

const titleSchema = z.looseObject({ aiTitle: z.string() });
const systemSchema = z.looseObject({
  subtype: z.string().optional(),
  uuid: z.string().max(200),
  timestamp,
});

function textOf(content: z.infer<typeof toolResultSchema>["content"]): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((part) => part.text ?? "").join("\n");
}

function usageOf(model: string, usage: z.infer<typeof usageSchema>): SessionEvent["usage"] {
  // Anthropic's output_tokens includes thinking; split it out so the counts stay disjoint.
  const output = usage.output_tokens ?? 0;
  const reasoning = Math.min(usage.output_tokens_details?.thinking_tokens ?? 0, output);
  return {
    model,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: output - reasoning,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    reasoningTokens: reasoning,
  };
}

/** One record → its events. null means "not understood" (counted as skipped). */
function parseRecord(raw: unknown, lineNo: number, state: TranscriptState): SessionEvent[] | null {
  const base = baseSchema.safeParse(raw);
  if (!base.success) return null;
  const { type, cwd, gitBranch } = base.data;
  // Records carry the shell's current folder, which moves with every `cd`; the session belongs
  // to the folder it started in (what `claude agents --json` reports too).
  state.cwd ??= cwd ?? null;
  if (gitBranch) state.gitBranch = gitBranch;
  if (IGNORED_TYPES.has(type)) return [];

  const event = (
    fields: Partial<SessionEvent> & Pick<SessionEvent, "externalId" | "type" | "occurredAt">,
  ): SessionEvent => ({
    sourceLine: lineNo,
    summary: null,
    code: null,
    usage: null,
    ...fields,
  });

  if (type === "ai-title") {
    const title = titleSchema.safeParse(raw);
    if (!title.success) return null;
    // Generated from the conversation, so it could repeat a pasted secret.
    state.title = redact(title.data.aiTitle, 300) || state.title;
    return [];
  }

  if (type === "system") {
    const system = systemSchema.safeParse(raw);
    if (!system.success) return null;
    return system.data.subtype === "compact_boundary"
      ? [
          event({
            externalId: system.data.uuid,
            type: "session.compacted",
            occurredAt: system.data.timestamp,
          }),
        ]
      : [];
  }

  if (type === "user") {
    const user = userSchema.safeParse(raw);
    if (!user.success) return null;
    const { uuid, timestamp: at, isMeta, isCompactSummary, origin, message } = user.data;
    const parts = typeof message.content === "string" ? [] : message.content;
    const text = (
      typeof message.content === "string"
        ? message.content
        : parts.map((part) => (typeof part.text === "string" ? part.text : "")).join("")
    ).trimStart();
    // Not every user record is a prompt: Claude Code also writes task notifications, relays,
    // command echoes and compaction summaries. Recent versions mark a person's input with
    // origin.kind "human" (even when it starts with a <tag>); without that field, fall back to
    // skipping <tag> text and interrupt markers.
    const isPrompt =
      !isMeta &&
      !isCompactSummary &&
      (origin
        ? origin.kind === "human"
        : !text.startsWith("<") && !text.startsWith("[Request interrupted"));
    const events: SessionEvent[] = [];
    let hasToolResult = false;
    for (const part of parts) {
      if (part.type !== "tool_result") continue;
      hasToolResult = true;
      const result = toolResultSchema.safeParse(part);
      if (!result.success || !result.data.is_error) continue;
      const tool = state.toolNames.get(result.data.tool_use_id);
      const text = redact(textOf(result.data.content));
      events.push(
        event({
          externalId: `${uuid}:${result.data.tool_use_id}`.slice(0, 200),
          type: "tool.error",
          occurredAt: at,
          summary: `${tool ?? "Tool"}${text ? `: ${text}` : " failed"}`,
        }),
      );
    }
    if (!hasToolResult && isPrompt) {
      events.push(event({ externalId: uuid, type: "message.user", occurredAt: at }));
    }
    return events;
  }

  if (type === "assistant") {
    const assistant = assistantSchema.safeParse(raw);
    if (!assistant.success) return null;
    const { uuid, timestamp: at, message } = assistant.data;
    if (assistant.data.isApiErrorMessage) {
      const text = message.content
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("\n");
      return [
        event({
          externalId: uuid,
          type: "api.error",
          occurredAt: at,
          summary: redact(text) || "API error",
          code: assistant.data.error ?? null,
        }),
      ];
    }
    const events: SessionEvent[] = [];
    // A response is split over one record per content block, each repeating the same usage, so
    // usage is keyed by message id and stored once.
    if (message.id && message.model && message.model !== "<synthetic>" && message.usage) {
      events.push(
        event({
          externalId: `message:${message.id}`,
          type: "message.assistant",
          occurredAt: at,
          usage: usageOf(message.model, message.usage),
        }),
      );
    }
    for (const part of message.content) {
      const tool = toolUseSchema.safeParse(part);
      if (!tool.success) continue;
      state.toolNames.set(tool.data.id, tool.data.name);
      events.push(
        event({
          externalId: tool.data.id,
          type: "tool.use",
          occurredAt: at,
          summary: tool.data.name,
        }),
      );
    }
    return events;
  }

  return null;
}

/**
 * Parses complete lines. Updates `state` (folder, branch, title, tool names), which is safe to
 * repeat if the same lines are parsed again after a failed send. Events repeat across records of
 * one response; they are deduplicated by externalId here and again by the database.
 */
export function parseTranscriptLines(
  lines: readonly Line[],
  state: TranscriptState,
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

/**
 * Claude Code names a transcript folder after the working folder with every non-alphanumeric
 * character replaced by "-", cut at 200 characters (documented). A subfolder's name starts with
 * its parent's; so do unrelated names ("app" and "app-old"), which the cwd check then drops.
 */
export function folderMayMatch(dirName: string, approvedFolders: readonly string[]): boolean {
  const name = dirName.toLowerCase();
  return approvedFolders.some((folder) => {
    const encoded = folder
      .replace(/[\\/]+$/, "")
      .replace(/[^a-zA-Z0-9]/g, "-")
      .slice(0, 200);
    return encoded !== "" && name.startsWith(encoded.toLowerCase());
  });
}

const SESSION_FILE = /^[\w-]{1,200}\.jsonl$/;

/**
 * Read access is narrow: only `<projects dir>/<folder>/*.jsonl` (no subfolders), and only in
 * folders whose name could encode an approved path.
 */
export function claudeProvider(projectsDir: string, approvedFolders: readonly string[]): Provider {
  return {
    source: "CLAUDE_CODE",
    dataDir: projectsDir,
    async listFiles() {
      const files: string[] = [];
      const errors: string[] = [];
      let dirs: string[];
      try {
        dirs = (await readdir(projectsDir, { withFileTypes: true }))
          .filter((d) => d.isDirectory() && folderMayMatch(d.name, approvedFolders))
          .map((d) => d.name);
      } catch (error) {
        return {
          files,
          errors: [`Can't read the Claude Code projects folder ${projectsDir}: ${code(error)}`],
        };
      }
      for (const dir of dirs) {
        try {
          const names = (await readdir(join(projectsDir, dir), { withFileTypes: true }))
            .filter((f) => f.isFile() && SESSION_FILE.test(f.name))
            .map((f) => join(projectsDir, dir, f.name));
          files.push(...names);
        } catch (error) {
          errors.push(`Can't read ${dir}: ${code(error)}`);
        }
      }
      return { files, errors };
    },
    newParser(path) {
      const state = newTranscriptState();
      return {
        parse: (lines) => parseTranscriptLines(lines, state),
        session: () => ({
          sessionId: basename(path, ".jsonl"),
          cwd: state.cwd,
          gitBranch: state.gitBranch,
          title: state.title,
          details: [],
        }),
      };
    },
  };
}
