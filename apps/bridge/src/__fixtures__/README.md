# Session fixtures

## Claude Code (`claude-session.jsonl`)

`claude-session.jsonl` is built from real Claude Code 2.1.x transcripts on the developer's machine
(ADR-004), with every piece of content redacted:

- Message text, thinking, tool inputs and tool results are replaced with `[redacted]`.
- The working folder is `D:\Projects\fixture-app` and the session id is a made-up UUID.
- Record structure, ids, timestamps, model names and token usage are kept as recorded.

These lines were added or changed by hand to cover edge cases:

- Line 9: the failing tool result's text is synthetic. It has a fake npm token on its second line,
  so tests can check that only the first line is kept and redacted.
- Line 12: a real API error from another project. The time zone name was cut from the end of its
  message text ("resets 2:50pm") and its branch set to `main`.
- Line 13: an unknown record type.
- Line 14: a truncated, invalid JSON line.

## Codex (`codex-session.jsonl`)

Built from real Codex 0.162 rollout records on the developer's machine (ADR-004, ADR-018) by
picking one record of each kind ADCC reads, from several rollout files, and joining them into
one session:

- Every string, and every object key that looks like a path (edits are keyed by file path;
  those become `D:/Projects/fixture-app/file-N`), is replaced with `[redacted]`, except structural values: record and item types,
  statuses, ids, call ids, model, tool and MCP server names, the client name and version,
  error codes and abort reasons.
- Session, turn and response ids are made up; the working folder is `D:\Projects\fixture-app`
  and the branch `main`. Large compaction history and instruction arrays were cut down.
- Timestamps were re-spaced 1.5 s apart. Token counts and exit codes are kept as recorded.

It mixes both record styles Codex 0.162 writes: the desktop app's `item_completed` items
(lines 5–13, 22) and the VS Code extension's `user_message`, `patch_apply_end` and `mcp_tool_call_end` events
(lines 26–29). Real files use one style or the other.

These lines were added or changed by hand to cover edge cases:

- Line 19: usage written before its turn's `turn_context` (line 21), as a compaction at the
  start of a turn does in real files.
- Line 28: line 27's edit with its `call_id` set to line 11's `FileChange` item id, so the
  same operation reported twice is counted once.
- Line 29: the MCP call's result is cut down to one redacted text block.
- Line 30: the failed turn's message is shortened from a real usage-limit error.
- Lines 31–32: usage and a `session_meta` copied from a parent thread, as at the start of a
  forked or subagent rollout. Neither belongs to this session.
- Line 33: an unknown record type. Line 34: a truncated, invalid JSON line.
