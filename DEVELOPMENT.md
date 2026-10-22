# Development — ADCC

How to set up, run and validate the project. Commands are PowerShell on Windows 11, run from
the repo root unless noted.

## Prerequisites

| Tool           | Version                              | Why                                |
| -------------- | ------------------------------------ | ---------------------------------- |
| Windows 11     | —                                    | only supported OS                  |
| WSL 2          | `wsl --install` (admin, then reboot) | required by Docker Desktop         |
| Docker Desktop | current, WSL2 backend                | runs PostgreSQL                    |
| Node.js        | 22.18+ or 24 LTS                     | Next.js, tooling, bridge (runs TS) |
| pnpm           | 10.34 (`corepack enable`)            | package manager (pinned in root)   |
| Git            | current                              | —                                  |

## First-time setup

```powershell
corepack enable
pnpm install                                   # also runs `prisma generate`
Copy-Item apps/web/.env.example apps/web/.env  # set POSTGRES_PASSWORD (letters+digits) and
                                               # put the same password in DATABASE_URL
pnpm db:up                                     # start Postgres (127.0.0.1:55432)
pnpm db:deploy                                 # apply committed migrations
pnpm --filter web exec playwright install chromium   # once, for e2e
pnpm dev                                       # http://127.0.0.1:3000
```

Check it works: `http://127.0.0.1:3000/api/health` returns `"status":"ok"`.

## Commands

| Command            | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `pnpm dev`         | Next.js dev server on `http://127.0.0.1:3000`                        |
| `pnpm bridge`      | Agent Bridge (Claude Code and Codex monitoring); see below           |
| `pnpm build`       | production build                                                     |
| `pnpm lint`        | Prettier check + ESLint (zero warnings allowed)                      |
| `pnpm format`      | Prettier write                                                       |
| `pnpm typecheck`   | Next route typegen + `tsc --noEmit`                                  |
| `pnpm test`        | Vitest unit tests (web and bridge)                                   |
| `pnpm test:e2e`    | Playwright; builds and starts its own server on 3100 (`adcc_e2e` DB) |
| `pnpm db:up`       | start Postgres container                                             |
| `pnpm db:down`     | stop containers, **keeps data**                                      |
| `pnpm db:migrate`  | dev only: create + apply a migration from schema changes             |
| `pnpm db:deploy`   | apply pending committed migrations (safe, never resets)              |
| `pnpm db:status`   | show applied / pending migrations                                    |
| `pnpm db:generate` | regenerate the Prisma client                                         |
| `pnpm db:studio`   | Prisma Studio (local data browser)                                   |

Commands that destroy data — `docker compose down -v`, `prisma migrate reset`,
`prisma db push --force-reset`, dropping tables — need explicit user approval every time.
There is deliberately no script for them. If `db:migrate` asks to reset the database, stop and
ask.

## Environment variables

One file, `apps/web/.env` (gitignored), read by Next.js, the Prisma CLI and docker compose.
Validated by the Zod schema in `apps/web/src/server/env.ts`; the server won't start if it's
invalid.

| Variable                       | Used by         | Notes                                         |
| ------------------------------ | --------------- | --------------------------------------------- |
| `POSTGRES_USER`                | db container    | default `adcc`                                |
| `POSTGRES_PASSWORD`            | db container    | URL-safe (letters and digits); not committed  |
| `POSTGRES_DB`                  | db container    | default `adcc`                                |
| `DATABASE_URL`                 | web, Prisma CLI | `postgresql://…@127.0.0.1:55432/adcc`         |
| `GITHUB_TOKEN`                 | web             | optional; fine-grained PAT, read-only (below) |
| `GITHUB_SYNC_INTERVAL_MINUTES` | web             | default 15; 0 = off, else 5–1440              |
| `GITHUB_API_URL`               | web             | default `https://api.github.com`; tests only  |
| `ADCC_BRIDGE_TOKEN`            | web             | optional; ≥ 32 chars; blank = bridge API off  |

The Agent Bridge has its own `apps/bridge/.env` (gitignored; copy `apps/bridge/.env.example`),
validated by `apps/bridge/src/config.ts`; it refuses to start if it's invalid.

| Variable                  | Notes                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| `ADCC_WEB_URL`            | default `http://127.0.0.1:3000`; must be http on 127.0.0.1 or localhost |
| `ADCC_BRIDGE_TOKEN`       | same value as in `apps/web/.env`                                        |
| `BRIDGE_APPROVED_FOLDERS` | required; `;`-separated absolute folders whose sessions may be read     |
| `CLAUDE_PROJECTS_DIR`     | default `%USERPROFILE%\.claude\projects`                                |
| `CLAUDE_EXE`              | default: the npm-installed `claude.exe`; must be an `.exe`              |
| `CODEX_HOME`              | default `%USERPROFILE%\.codex` (Codex's own variable, if you set it)    |
| `BRIDGE_POLL_SECONDS`     | default 10; 5–300                                                       |

### GitHub token (Phase 4, ADR-016)

ADCC only reads GitHub. Give it a **fine-grained** personal access token; classic (`ghp_`) and
OAuth (`gho_`, e.g. from `gh auth token`) tokens are refused at startup because they can't be
limited to read-only.

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token. Set an expiry.
2. Repository access: only the repositories you want in ADCC.
3. Repository permissions, all **Read-only**: Metadata, Contents, Pull requests, Issues,
   Actions. Nothing else, and no account permissions.
4. Put it in `apps/web/.env` as `GITHUB_TOKEN=github_pat_…` and restart `pnpm dev`.

The GitHub page then shows the account, token expiry and remaining API quota. A revoked or
expired token shows as a 401 there and on each repository; replace it in `.env` and restart.
Without a token the GitHub pages say "not connected" and nothing is fetched.

Generate random secrets with a cryptographic RNG:

```powershell
$b = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

## Agent Bridge and Claude Code monitoring (Phase 5, ADR-017)

The bridge is a separate Node process on the host. It reads Claude Code and Codex session
metadata (Codex: next section) and sends it to the web app on loopback. It opens no port, writes no file, and runs exactly one
command: `claude.exe agents --json`.

1. Generate a secret (below) and put it in both `apps/web/.env` and `apps/bridge/.env` as
   `ADCC_BRIDGE_TOKEN`. Set `BRIDGE_APPROVED_FOLDERS` in `apps/bridge/.env`, for example
   `D:\Projects`.
2. Restart `pnpm dev`, then run `pnpm bridge` in a second terminal and leave it running.
3. Open **AI Agents**. The Agent Bridge card should say _Connected_, and its _Sources_ list
   says, per tool, which folder it reads, how many session files it found and whether the
   folder could be read. A tool that isn't installed shows _Unavailable_; the other keeps
   working. To map sessions to projects, give each project its local folder; the deepest
   matching folder wins. Filter the list by tool with the tabs above it; **Refresh** re-reads
   the page (the bridge sends on its own schedule, every `BRIDGE_POLL_SECONDS`).

What is shown, and where it comes from:

| Shown                                 | Source                                                    | Documented?                 |
| ------------------------------------- | --------------------------------------------------------- | --------------------------- |
| Running / idle / busy / waiting       | `claude agents --json`, each poll                         | yes: "supported way"        |
| Sessions, start, last activity        | transcript `~/.claude/projects/<folder>/<session>.jsonl`  | location yes, format **no** |
| Model, token usage per response       | transcript `assistant` records (`message.model`, `usage`) | **no**                      |
| Tool use (name only), tool/API errors | transcript `tool_use`, `tool_result.is_error`, API errors | **no**                      |
| Title                                 | transcript `ai-title` record                              | **no**                      |

Limitations:

- **The transcript format is internal to Claude Code** and changes between releases (the docs
  say so). Unrecognised records are counted and shown as "records not recognised and skipped"
  on the session page, never guessed at. If that number climbs after a Claude Code update, the
  parser (`apps/bridge/src/claude-transcript.ts`) needs updating against a new redacted
  fixture. Verified against Claude Code 2.1.296–2.1.304.
- **Running status needs a working bridge.** A session is _Running_ only while the bridge's
  latest report and the `claude agents --json` check inside it are both current (no older
  than three poll intervals, at least 30 s) and the check lists it. Otherwise every session
  shows _Unverified_ with its last observed activity, and the page says why. ADCC never infers
  "running" from recent activity.
- **Redaction:** prompts, responses, thinking, tool inputs and tool outputs never leave the
  bridge. The only free text is the tool name, the AI-generated session title, and the first
  line of a tool or API error. Titles and error lines have control and bidi characters
  removed, anything shaped like a credential masked (known token prefixes, `key=value` and
  `--flag value` pairs for password/secret/token/key/cookie/session/auth names, long opaque
  strings), and are clipped. This is a denylist: a secret in an unusual shape can still get
  through, and error lines can name files or commands.
- **Token counts:** one record per model response, keyed by message id. A resumed or forked
  session's transcript repeats earlier responses (seen on this machine: 341 message ids in
  more than one transcript), and their usage stays with the session that recorded them first,
  so totals across sessions aren't double-counted. Those repeated responses still appear in
  both sessions' timelines and tool counts.
- **User prompts** are user records Claude Code marks `origin.kind: "human"`. Meta records,
  task notifications, relays and compaction summaries don't count. Records without `origin`
  (older versions) count unless they start with a `<tag>` or are an interrupt marker. That
  rule is a judgement about an undocumented format.
- **Project mapping** happens when a session's records arrive. A project folder set or
  changed later applies to older sessions after the bridge restarts (it re-reads everything).
  Removing a folder doesn't unassign sessions.
- **Trust:** any process running as you can read `apps/bridge/.env` and send reports with the
  token, including a fake live status. That's inherent to a local shared secret (ADR-006).
  `read-only.test.ts` is a tripwire against accidental changes, not a sandbox.
- **Not read:** subagent transcripts (`<session>/subagents/`), `tool-results/` files, and
  sessions whose first recorded working folder is outside `BRIDGE_APPROVED_FOLDERS`.
  Sessions are matched to a folder by where they _started_.
- **No cost.** Token counts only; cost comes with the price table in Phase 7. Thinking tokens
  are split out of `output_tokens` into Reasoning.
- **Restarting the bridge re-reads every transcript in the approved folders**, one file at a
  time and at most 16 MB per read. The web app ignores duplicates, but a large history makes
  the first catch-up slow; the heartbeat goes first each cycle, so status stays current. A
  single line over 16 MB is skipped and counted. A transcript with no working folder in its
  first 1 MB is never sent. Transcripts Claude Code deleted (default retention 30 days) stay
  in ADCC.
- **Hooks, the status line, OpenTelemetry and the Agent SDK are not used.** Hooks carry no
  token or per-response model data and would need edits to your global Claude Code settings.
  The status line only runs while a session renders. OpenTelemetry needs a receiver port. The
  SDK's session reader returns the same undocumented records. See ADR-017.

## Codex monitoring (Phase 6, ADR-018)

The same bridge reads Codex sessions; nothing to set up beyond the steps above. It was
checked against the Codex desktop app and VS Code extension (Codex 0.162) on Windows. No
`codex` CLI was on `PATH`, and Codex documents no command or file for reading session state
from outside, so everything comes from files Codex writes for itself:

| Shown                                        | Source (under `%USERPROFILE%\.codex`)                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Sessions, folder, branch, start, last active | `sessions\<yyyy>\<mm>\<dd>\rollout-*.jsonl`, first `session_meta` record                                    |
| Client, Codex version, subagent, fork        | the same `session_meta` record (shown with the session's details)                                           |
| Title                                        | `session_index.jsonl` (thread names)                                                                        |
| Model, token usage per response              | `turn_context` (model per turn) and `token_usage_record`                                                    |
| Prompts                                      | `UserMessage` items (desktop) or `user_message` events (VS Code)                                            |
| Tool use (the model's calls)                 | `custom_tool_call` / `function_call` records, e.g. `exec`                                                   |
| Operations completed, failures, exit codes   | `CommandExecution`/`FileChange`/`McpToolCall`/`WebSearch` items, or `patch_apply_end` / `mcp_tool_call_end` |
| Turns completed / aborted, API errors        | `task_complete` (with `error`), `turn_aborted`                                                              |

None of these formats is documented, and they differ from Claude Code's. Limitations:

- **No live status.** Codex has no supported way to list running sessions, so every Codex
  session shows _Unverified_ with its last observed activity. ADCC doesn't guess from recent
  activity, and _Running now_ counts Claude Code sessions only.
- **Two record styles.** The desktop app records prompts and operations as `item_completed`
  items; the VS Code extension writes `user_message`, `patch_apply_end` and `mcp_tool_call_end`
  events and records no commands separately (its operations are edits and MCP calls). Both are read; one operation
  reported both ways shares an id and counts once. In the desktop style a model `exec` call
  and the commands it ran are counted separately, as _tool use_ and _operations_.
- **Token counts** come from `token_usage_record`, one per response. Cached input is split
  out of `input_tokens` and reasoning out of `output_tokens` so counts don't overlap.
  `cache_write_input_tokens` was 0 in every record seen, so how it relates to `input_tokens`
  is unverified (it's treated like cached input). The running totals in `token_count` aren't
  used. Usage written before its turn's model is known (a compaction) is held until the
  turn's `turn_context` arrives; usage whose turn never names a model isn't stored.
- **Forks and subagents** (guardian reviews, spawned workers) are sessions of their own. Their
  files start with a copy of the parent's history: copied usage stays with the parent
  (matched by `thread_id`), but copied prompts and tool calls also appear in the child, as
  with Claude Code's resumed sessions.
- **Every rollout file is opened** (the file name doesn't say which folder the session ran
  in); one outside `BRIDGE_APPROVED_FOLDERS` is dropped after at most its first 1 MB and never
  sent.
- **Titles** are sent with a session's next new records, so renaming a thread that's caught
  up shows after its next turn or a bridge restart. A session with no name shows its id.
- **Redaction** is as for Claude Code, but stricter: no command or tool output text at all.
  Failures carry only the tool name and exit code; the only error text is the first line of
  a failed turn's message (e.g. a usage-limit notice).
- **Not read:** Codex's SQLite databases (`state_*.sqlite`, `logs_*.sqlite`, …), rate-limit
  data, `archived_sessions` (not present here), and anything else under `.codex`.
- On a Claude Code version without `claude agents --json`, or if `claude.exe` isn't the npm
  install (set `CLAUDE_EXE`), the live check fails and every session shows _Unverified_.

## Usage analytics (Phase 7, ADR-019)

`/analytics` reads the token usage the bridge has stored; there's nothing to set up for the
counts. Costs need prices, which ADCC never ships or fetches:

1. Open **Analytics → Prices and budgets** (`/analytics/settings`). _Recorded models with no
   price_ lists every model id seen in usage.
2. **Add price** for each, from the provider's published price list: USD per million tokens,
   the first day it applies, and where you read it. Leave a rate blank if you don't know it;
   usage with that kind of token then shows as unpriced rather than guessed. Anthropic and
   OpenAI bill thinking/reasoning tokens as output, so enter the output rate there if that's
   what their price list says.
3. When a price changes, add a new version with the new date. Earlier usage keeps the old one.
4. Say how you pay for each tool (API key or subscription) and, optionally, set monthly token
   or estimated-cost budgets and the warning percentage.

What the page will and won't tell you:

- **Recorded tokens** are verified counts from session files. **Estimated API-equivalent
  cost** is those counts × your prices: never a charge. **Billed cost** isn't available; your
  provider's console has it. On a subscription there is no per-token charge at all.
- Days are calendar days in this machine's time zone (shown on the page). Weeks start on
  Monday. Budgets compare the current calendar month to date.
- Usage with no price shows as "No price" and totals as "≥ $x"; the _Missing data_ card says
  how much and why, along with sessions not linked to a project, sessions with unread records,
  and the first day usage was recorded (earlier periods are "no data", not zero).
- **Export CSV** downloads the shown range, one line per day, session and model, with the
  price version used and the estimate (blank when unknown).
- Not modelled: discounts, batch or regional pricing, long-context tiers, cache-write
  durations, taxes and credits. Note what a price assumes in its _Assumptions_ field.

## Ports

| Port  | What                      | Note                               |
| ----- | ------------------------- | ---------------------------------- |
| 3000  | `pnpm dev` / `pnpm start` | loopback only                      |
| 3100  | Playwright's own server   | `next start`; never reuses one     |
| 3101  | Playwright's mock GitHub  | serves recorded fixtures (e2e)     |
| 55432 | Postgres (host side)      | deliberately not 5432; see ADR-009 |

## Workflow per phase

1. Read CLAUDE.md, the relevant ARCHITECTURE.md sections, and the phase in ROADMAP.md.
2. Inspect the existing code the phase touches.
3. Implement only that phase's checklist.
4. Write tests for business logic as you go (parsers, cost maths, state machines, validation).
5. Run the validation gate: `pnpm lint; pnpm typecheck; pnpm test; pnpm build; pnpm test:e2e`.
6. Tick the boxes in ROADMAP.md; note anything that could not be validated.
7. Add an ADR to ARCHITECTURE.md for any new architectural decision.

## Testing guidelines

- **Unit (Vitest):** colocate as `*.test.ts` next to the code. Pure logic, no network. Services
  are tested with `@/server/db/*` mocked.
- **Database tests:** run against a separate test database, never the dev database.
- **E2E (Playwright):** under `apps/web/e2e/`. `navigation.spec.ts` covers the shell and
  pages; `accessibility.spec.ts` runs axe (WCAG 2.1 A/AA) on every page in dark and light;
  `projects.spec.ts` runs the project/task/board flows and axe on detail pages and dialogs;
  `agents.spec.ts` feeds the bridge's redacted Claude Code and Codex fixtures through their
  real parsers into `/api/bridge/ingest` and checks the agent pages; `analytics.spec.ts` ingests the
  Claude Code fixture under a run-unique model id, then adds and deletes a fixture price,
  saves budgets, exports CSV and runs axe on the analytics pages with data; `github.spec.ts` links, syncs and browses a repository against a loopback mock GitHub
  (`e2e/github-mock.ts`, recorded fixtures) that Playwright starts and points the app at, so
  e2e never calls the real GitHub whatever `.env` holds. Query page content inside `#main`:
  while a page streams in, React briefly parks the next chunk in a hidden div outside it.
  E2E must pass whether or not Postgres is running; assert on the real response, never on
  invented data. The server is a production build, which answers before React hydrates:
  open dialogs and menus with `clickUntilOpen` (`e2e/helpers.ts`) and send shortcuts with
  `pressUntil`.
- **E2E time zone:** the e2e server runs with `TZ=Asia/Seoul`, so analytics day boundaries
  are tested ahead of UTC on any machine.
- **E2E database (ADR-014):** global setup creates `adcc_e2e` next to the dev database (same
  server and credentials from `apps/web/.env`), migrates it and truncates it on every run.
  Flows that write data skip when `/api/health` is not `ok`. Name created rows with the
  run id so they never collide. The dev database is never touched.
- **Checking pages with data when Docker isn't available:** run the committed migration on a
  throwaway PGlite socket server outside the repo, seed it with obviously-fixture rows, and
  start `next dev` on another port with `DATABASE_URL` pointing at it. Never seed the real
  database. PGlite ignores the `TimeZone` startup option, so run `SET TIME ZONE 'UTC'` on it
  first (ADR-010), and give it `--max-connections` of 20 or more (the Overview runs about 11
  queries at once).
- **Fixtures:** real data must be redacted (paths, usernames, prompts with secrets) before
  committing. Fixtures never leak into the running app.
- **Bridge tests** (`apps/bridge/src/*.test.ts`): the Claude Code and Codex parsers against
  `apps/bridge/src/__fixtures__/claude-session.jsonl` and `codex-session.jsonl` (real records,
  redacted; see the README there), the scanner on temp folders, the live check with a stubbed runner, and
  `read-only.test.ts`, which fails if bridge code gains a way to run other commands, write
  files or listen on a port.
- **No live network** in tests — use recorded GitHub responses
  (`apps/web/src/server/github/__fixtures__/`, recorded with `gh api` from the public
  `octocat/Hello-World`; `mockGitHubFetch` serves them to Vitest).

## Database

- Schema: `apps/web/prisma/schema.prisma`. Migrations: `apps/web/prisma/migrations/`, committed.
- Change the schema, then `pnpm db:migrate --name <change>` (dev). Review the generated SQL
  before committing. Elsewhere apply with `pnpm db:deploy`.
- CHECK constraints are hand-written at the end of a migration's SQL. Keep them when editing.
- Destructive migrations (drop/rename column or table) need approval and a data-preserving
  plan first.
- Data lives in the `adcc-db` Docker volume. Back up with
  `docker compose exec db pg_dump -U adcc adcc > backup.sql`.

## Version pins worth knowing

- **TypeScript 6.0.x**: typescript-eslint doesn't support TS 7 yet.
- **Prisma 7.10.1**: npm's `latest` tag points at an 8.0 release candidate; don't follow it.

## Troubleshooting

- **Docker won't start / "WSL not installed":** run `wsl --install` as admin and reboot.
- **Port in use:** `Get-NetTCPConnection -LocalPort 3000 -State Listen | Select OwningProcess`,
  then check what it is before stopping it. It may be another of your projects.
- **`/api/health` is `degraded`:** the `error` field says why; usually Postgres isn't up
  (`pnpm db:up`) or `DATABASE_URL` doesn't match `POSTGRES_PASSWORD`.
- **Page reloads itself endlessly in dev (`HMR hash mismatch` in the browser websocket):** a
  stale Turbopack cache, usually after several dev servers shared `apps/web/.next`. Stop all
  dev servers, delete `apps/web/.next`, start again.
- **GitHub says "rate limit reached":** background sync pauses until the reset time shown on
  the GitHub page; manual refresh works again after it.
- **Times look hours off:** the database session isn't UTC; see ADR-010.
- **Server exits with "Invalid environment configuration":** fix the named variable in
  `apps/web/.env`.
- **AI Agents says _Not reporting_ or _Never connected_:** is `pnpm bridge` running? It logs
  each failed send. A 401 means the two `ADCC_BRIDGE_TOKEN` values differ; a 503 means the web
  app has none.
- **Live session check failed (`ENOENT`):** set `CLAUDE_EXE` in `apps/bridge/.env` to your
  `claude.exe`.
- **A source says _Unavailable_:** that tool's folder couldn't be read; the message names the
  folder and error code. `ENOENT` usually means the tool isn't installed or keeps its data
  elsewhere: set `CLAUDE_PROJECTS_DIR` or `CODEX_HOME` in `apps/bridge/.env`.
- **"Records not recognised" climbs on Codex sessions:** a Codex update changed the rollout
  format; update `apps/bridge/src/codex-rollout.ts` against a new redacted fixture.
