# Architecture — ADCC

## Overview

```
 Windows 11 host
 ┌──────────────────────────────────────────────────────────────────────┐
 │                                                                      │
 │  Desktop shortcut ──► start-adcc.ps1                                 │
 │                          │ docker compose up                         │
 │                          │ start Agent Bridge                        │
 │                          │ open http://127.0.0.1:3000                │
 │                                                                      │
 │  Docker Desktop (WSL2)                      Host processes           │
 │  ┌───────────────────────────────┐          ┌─────────────────────┐  │
 │  │ web  (Next.js)  127.0.0.1:3000│◄─HTTP────│ Agent Bridge (Node) │  │
 │  │   │ Prisma                    │  bridge  │  - reads session    │  │
 │  │   ▼                           │  token   │    files            │  │
 │  │ db   (PostgreSQL) 127.0.0.1:  │          │  - polls approved   │  │
 │  │      55432, named volume      │          │    actions, runs    │  │
 │  └───────────────────────────────┘          │    them, reports    │  │
 │                                             └─────────┬───────────┘  │
 │                                                       │ reads        │
 │                       %USERPROFILE%\.claude\projects\  ▼              │
 │                       %USERPROFILE%\.codex\sessions\                 │
 │                       git repos, PowerShell                          │
 └──────────────────────────────────────────────────────────────────────┘
          web ──HTTPS──► api.github.com (outbound only)
```

Target state. Until Phase 10 the web app runs on the host via `pnpm dev`, and only Postgres is
in Docker (ADR-009). The bridge runs on the host with `pnpm bridge` (Phase 5); it monitors
Claude Code and Codex (Phase 6) and runs no actions until Phase 9.

## Components

### `apps/web` — Next.js dashboard

- Next.js App Router, React, TypeScript strict, Tailwind, shadcn/ui, Recharts.
- Owns the database (Prisma 7 with the `pg` driver adapter) and all business logic.
- Exposes a small, token-authenticated **bridge API** under `/api/bridge/*` that only the
  Agent Bridge calls (Phase 5).
- Calls GitHub's REST API outbound with a user-supplied token (Phase 4).
- `GET /api/health` returns `{ status: "ok" | "degraded", timestamp, checks[] }`: 200 when
  every check is up, 503 otherwise.

Source layout (ADR-007):

```
apps/web/
  src/
    domain/           pure types, Zod schemas, business rules. No I/O or framework imports.
    server/
      env.ts          Zod-validated environment (checked at boot by instrumentation.ts)
      db/             Prisma client and queries: the only code that touches the database
      services/       use cases; combine domain rules with db access
      github/         GitHub adapter: the only code that calls GitHub (GET only)
    app/              routes, layouts, route handlers: thin, call services
    components/       UI: ui = shadcn (generated, don't hand-edit), app-shell = sidebar/top bar/
                      search/notifications/theme, dashboard = shared page pieces, settings
    hooks/            client hooks
    lib/              UI helpers (cn, number/date formatting)
    generated/prisma/ generated client (gitignored, rebuilt on install)
  prisma/             schema.prisma, migrations/
  e2e/                Playwright tests
```

Unit tests sit next to the code as `*.test.ts`.

### UI shell and page data (Phase 2)

- Root layout: `next-themes` (dark default, light, system; stored in localStorage) →
  `SidebarProvider` (open/collapsed kept in the `sidebar_state` cookie, read on the server so
  there's no flash) → `AppSidebar` + `TopBar` + page. Navigation items live in one place:
  `components/app-shell/nav.ts`.
- Pages are server components. Each calls one function in
  `server/services/dashboard-service.ts` wrapped in `load()`, which returns
  `{ ok: true, data } | { ok: false, error }`. Pages render data, an empty state, or
  `DataUnavailable`. They never render zeros for data they could not read (ADR-011).
- Global search is a server action (`app/actions/search.ts`): Zod-validates the query (2–100
  chars), then case-insensitive `contains` on project name/slug and task title, 5 each.
- Notifications are derived from `/api/health`, fetched by the client on mount and on open.

### Mutations (Phase 3)

- Forms submit to Server Actions in `app/actions/` (`projects.ts`, `tasks.ts`). Each passes the
  raw `FormData` object to a service, which Zod-parses it (schemas in `src/domain`) and checks
  the business rules; ids and statuses from the client are untrusted input like any other.
- `app/actions/mutate.ts` maps a `DomainError` (a broken rule, safe to show) or `ZodError` to
  form state with per-field messages. Anything else is logged and reported as a failed save.
  On success it revalidates every page, since many pages show the same rows.
- Every write and its `ActivityEvent` happen in one transaction in `src/server/db`, so the
  timeline and task history can't miss or invent a change. Task history is the task's
  activity events; change descriptions come from `describeTaskChanges` in the domain.
- Forms submit through `useFormAction` (`components/dashboard/form-fields.tsx`), not
  `<form action>`, because React resets uncontrolled fields after a form action even when it
  fails, which would wipe what the user typed.
- The Kanban board moves cards optimistically (`useOptimistic`); a refused move (e.g. a blocked
  task) rolls back and the reason is announced in a live region. Drag-and-drop is native HTML5;
  every card also has a "Move" menu for keyboard and touch.
- Next.js checks the `Origin` of Server Action requests against `Host`, which covers the
  CSRF part of the security model for these mutations.

### GitHub integration (Phase 4)

```
src/server/github/client.ts      adapter: GET-only fetch, Zod-parsed, typed GitHubError
        ▲                         (unauthorized | forbidden | not_found | rate_limited | …)
src/server/services/github-service.ts
        │  syncRepository(id): fetch snapshot → saveSnapshot (one transaction)
        │  syncAll / syncDue: one repo at a time, stop on rate limit or rejected token
        │  startBackgroundSync(): 60 s tick from instrumentation.ts
        ▼
src/server/db/github.ts          Repository sync state + GitHub* cache tables + ActivityEvents
```

- **Adapter** (`server/github/client.ts`): the only code that talks to GitHub. It can only
  send `GET` to `GITHUB_API_URL` with the token in the `Authorization` header. Responses are
  parsed by the schemas in `domain/github.ts`, which also normalise them (lowercase
  owner/name, PR `merged` state, first line of commit messages, PRs dropped from issues).
  Transient failures (network, 5xx) are retried twice with backoff; 401, 403, 404 and rate
  limits become a `GitHubError` whose message is safe to show and never contains the token.
  Requests run one at a time, as GitHub asks integrations to.
- **What a sync reads** per repository: the repo, branches (100), recent commits on the
  default branch (30), open PRs (100, so the open count is real; "100+" at the cap) and the 20
  most recently closed, reviews of up to 20 open PRs, issues (30 most recently updated items,
  PRs removed; skipped when the repo has issues turned off, which GitHub answers with 410),
  workflow runs (20). About 8 + open-PR requests per sync. Strings are clipped to their
  column sizes and links must be https, so one odd value can't fail every sync.
- **Rate limits:** a 429, or a 403 with `remaining: 0`, `retry-after` or a rate-limit
  message, is `rate_limited`, with GitHub's reset time or at least 60 s. Until then every
  sync, manual or background, returns that result without calling GitHub. Rate limits and a
  rejected token don't count toward a repository's own backoff.
- **Review status** is derived from reviews (`summarizeReviews`): each reviewer's latest
  approval or change request counts, a dismissal cancels it. It's a count of what reviewers
  said, not GitHub's merge verdict (branch protection isn't read). Closed PRs show "—".
- **Storage** (ADR-015): each successful sync replaces the repository's rows in the five
  `github_*` tables and updates `lastSyncedAt`, all in one transaction. A failed sync keeps the
  last good rows and records `lastSyncAttemptAt`, `lastSyncError`, `syncFailures`.
- **Timeline:** each sync writes `ActivityEvent`s for commits, PRs opened/merged/closed,
  issues opened/closed and completed workflow runs, at the time they happened on GitHub, with
  `dedupeKey` `github:<repo githubId>:<kind>:<id>…` (the id, so a rename repeats nothing), inserted with `skipDuplicates`. Re-syncing
  adds nothing. The repository page shows its own events; they also appear on Activity.
- **Background sync:** a 60-second tick syncs linked repositories of non-archived projects
  whose `nextSyncAt` has come: one `GITHUB_SYNC_INTERVAL_MINUTES` after the last attempt,
  doubled per consecutive failure up to 32×. A rate limit pauses it until GitHub's reset time; a
  401 pauses it until restart. An in-process lock makes a manual refresh and a background pass
  on the same repository share one sync.
- **Pages:** `/github` shows the connection (account, token expiry, remaining quota), linked
  repositories with sync state, and the repositories the token can read with a "link to
  project" control (it uses the Phase 3 link action and rules). `/github/[id]` shows PRs,
  runs, commits, issues, branches and the timeline, with a Refresh button. Before the first
  sync, counts show "—", not 0 (ADR-011).

### Claude Code monitoring (Phase 5)

```
apps/bridge (host)                                    apps/web
  claude-live.ts  claude.exe agents --json ─┐
  scanner.ts      new lines of approved     ├─► POST /api/bridge/ingest (bearer token, Zod)
  claude-transcript.ts  → redacted events  ─┘        │ agent-service.ingestBridgeReport
                                                      ├─ ApplicationSetting "bridge.status"
                                                      └─ AgentSession / AgentEvent / UsageRecord
```

- **Each poll** (default 10 s) the bridge first sends a heartbeat: its status (version,
  approved folders, problems) and the live check (`claude agents --json`, filtered to approved
  folders), with no sessions. Then it works through the transcripts one file at a time. Every
  request carries the status, plus at most 500 new events; the live check is re-run when it's
  more than one poll old. The web app stores the latest status whole in
  `application_settings` (`bridge.status`, validated by `storedBridgeStatusSchema`) with the
  time it arrived. A file the web app rejects (4xx) is skipped and reported on the next
  heartbeat; an unreachable web app ends the cycle.
- **Providers (Phase 6):** the scanner is generic; each tool is a `Provider` (`scanner.ts`)
  that lists its files and parses their lines: `claudeProvider` in `claude-transcript.ts`,
  `codexProvider` in `codex-rollout.ts` (see "Codex monitoring"). Each provider is listed on
  its own each cycle and reports a `ProviderStatus` (folder, files found, listing error) in
  the heartbeat, so one tool's missing or unreadable folder never stops the other.
- **Transcripts:** the scanner opens only `<projects dir>/<folder>/*.jsonl` where the folder
  name could encode an approved path (Claude Code's documented naming). From the last
  committed byte offset it reads up to 16 MB, to the last complete line, and parses with
  `claude-transcript.ts`. A line over 16 MB is skipped and counted. It sends the file only
  once the first recorded `cwd` is inside an approved folder, and gives up if none is recorded
  in the first 1 MB. Offsets are committed only after the web app accepts every batch of a
  read, so a failed send is re-read next time.
- **Events** (`SESSION_EVENT_TYPES` in `@adcc/shared`): `message.user`, `message.assistant`
  (keyed by message id; carries model and usage, once per response although the transcript
  repeats it per content block), `tool.use` (tool name), `tool.error` and `api.error`
  (redacted first line, Claude Code's error code), `session.compacted`; Codex adds
  `operation.completed`, `turn.completed` and `turn.aborted`. Ignored bookkeeping
  records are listed; anything else counts toward `skippedRecordCount`.
- **Storage:** `saveSessionBatch` upserts the session (earliest start, latest activity; known
  values are never overwritten by null; `skippedRecordCount` is the bridge's latest running
  total), inserts events and usage with `skipDuplicates`, all in one transaction. A
  response's usage is stored once across all sessions: resumed and forked transcripts repeat
  earlier responses under the same message id, and those stay with the session that recorded
  them first. The project is the one whose `localPath` holds the session's starting folder
  (deepest wins), set when the session's records arrive.
- **Status** is computed when a page is read, never stored (`sessionState`, `liveCheck`). It
  is _running_ (with Claude Code's busy/idle/waiting) only if the stored report **and** the
  live check inside it are current (three poll intervals, at least 30 s each), the check
  succeeded, and it lists the session id. It is _not running_ if such a check doesn't list it,
  and _unverified_ otherwise (always, for non-Claude sources), in which case pages show the
  last observed activity and the reason.
- **Pages:** `/agents` shows the bridge card (connection, last report, live-check time, approved
  folders, bridge errors), counts, and sessions with status, model, project, tokens, errors and
  last activity, filterable by tool (`?source=`). `/agents/[id]` shows the same plus token
  usage per model, errors, tool counts, provider details and the latest 200 events. Sessions
  without usage show "—" tokens, not 0. A Refresh button re-reads the page.

### Codex monitoring (Phase 6)

- **Files:** `codexProvider(CODEX_HOME)` lists `sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`
  (strict name patterns, no other folders) and reads `session_index.jsonl` for thread names.
  File names don't encode the working folder, so each rollout is opened once; the first
  `session_meta` gives the session id, `cwd`, branch and details, and a file outside the
  approved folders is excluded like a Claude transcript.
- **Parsing** (`codex-rollout.ts`, loose Zod per record, unknown records counted): usage from
  `token_usage_record` with the model from the turn's `turn_context` (held if the record comes
  first), keyed `response:<id>`, cached input and reasoning split out; records whose
  `thread_id` isn't this session are a parent's copied history and are ignored. Prompts are
  `UserMessage` items or `user_message` events; `tool.use` is the model's `custom_tool_call` /
  `function_call`; `operation.completed` / `tool.error` come from operation items or
  `patch_apply_end` / `mcp_tool_call_end`, keyed `op:<exec id>` so both styles can't double count;
  `task_complete` / `turn_aborted` give turn outcomes and `api.error`.
- **Storage:** the batch carries `source` and `details` (labelled metadata: client, version,
  subagent, fork), stored in `AgentSession.details` (JSON, validated on read). Codex sessions
  are always _unverified_ (ADR-018).

### Usage analytics (Phase 7)

```
usage_records ─┐ server/db/usage.ts usageRowsBetween(from, to, timeZone)
               │   one SQL GROUP BY (local day, session, model), sums as bigint
model_prices ──┤ server/db/pricing.ts listPrices() (Decimal → number)
settings ──────┘ "analytics.settings": billing type per tool, monthly budgets
        ▼
domain/analytics.ts + domain/pricing.ts (pure, unit-tested)
  priceRows → summarize / analyzeUsage (by tool, model, project, session, trend)
  budgetStatus, usageCsv, resolveAnalyticsQuery (range + period from the URL)
        ▼
/analytics (overview, charts, breakdowns, missing data), /analytics/settings (prices,
billing, budgets), /analytics/export (CSV, same range)
```

- **Four kinds of number, never mixed** (ADR-019): _recorded tokens_ (verified, from session
  files), _estimated API-equivalent cost_ (tokens × the user's price table; always labelled an
  estimate), _billed cost_ (not available: no billing source is read; shown as "—"), and the
  user's _billing type_ per tool (API key / subscription / not set), which says what the
  estimate means. A subscription has no per-token charge, so its estimate is only what the
  same usage would cost at API prices.
- **Prices** are versions in `model_prices`: exact model id, first day it applies, USD per
  million tokens for input and output, and optional cache read, cache write and reasoning
  rates, plus a required source and optional assumptions. A version applies until the model's
  next one. ADCC ships no prices. Cost is computed when a page is read and never stored
  (ADR-008).
- **Unknown stays unknown:** usage with no price on its day, or with tokens of a kind whose
  rate is blank, has no estimate. Totals add only what could be estimated and carry the
  unpriced token count, so a partly priced figure shows as "≥ $x" and a wholly unpriced one as
  "No price", never $0, per tool in each trend period too. A budget meter with unpriced usage
  says it can't tell, unless even the known part is over.
- **Days** are calendar days in the server's time zone (the user's machine), computed in SQL
  with `AT TIME ZONE` and in JS with `Intl`. Ranges come from `?from=&to=&period=`; anything
  invalid falls back to the last 30 days with a notice, ranges end today and are capped at
  3 years. Weeks start on Monday. Periods before the first usage ever recorded are "no data",
  not zero; later periods with no usage are a real zero.
- **Missing data** is listed per range: unpriced tokens and why, sessions with no project,
  sessions with unread records, the first recorded day, tools with no billing type, and billed
  cost. Charts have a table view; the cost chart is replaced by a message when nothing is
  priced, since an empty chart reads as $0.
- **CSV:** one line per day, session and model, with the price version used and the estimate
  (blank when unknown, with the reason). Text cells that a spreadsheet would run as a formula
  are prefixed with `'`.
- **Charts** are Recharts through shadcn's `chart` component, stacked by tool with
  `--chart-1` / `--chart-4` (checked for colour-blind separation and contrast in both themes).

## Data model

Defined in `apps/web/prisma/schema.prisma` (ADR-008).

| Model                | Purpose                                      | Key constraints                                            |
| -------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| `Project`            | a piece of work; status; optional folder     | unique `slug`, unique `localPath`; delete only archived    |
| `Repository`         | GitHub repo, optionally linked to a project  | unique `(owner, name)`, unique `githubId`; sync state      |
| `GitHub*` (5 tables) | branches, commits, PRs, issues, runs cache   | PK `(repositoryId, natural key)`; cascade; state CHECKs    |
| `Milestone`          | dated goal inside a project                  | unique `(projectId, title)`                                |
| `Task`               | unit of work in a project, maybe a milestone | indexed `(projectId, status)`; optional `assignedAgent`    |
| `TaskDependency`     | task waits on another task                   | PK `(taskId, dependsOnId)`; not self (CHECK); cascade      |
| `TaskComment`        | comment on a task                            | non-blank body (CHECK); cascade with the task              |
| `AgentSession`       | one Claude Code / Codex session file         | unique `(source, externalId)`; skipped-record count ≥ 0    |
| `AgentEvent`         | one record from a session file               | unique `(sessionId, externalId)` → idempotent re-ingest    |
| `UsageRecord`        | token counts for one event                   | one per event; all token counts ≥ 0 (CHECK); no cost col.  |
| `ActivityEvent`      | timeline entry from a real event             | unique `dedupeKey`; optional links to project/repo/task    |
| `ModelPrice`         | one version of a model's price (Phase 7)     | unique `(model, effectiveFrom)`; rates ≥ 0, source (CHECK) |
| `ApplicationSetting` | key → JSON value                             | value validated by a domain Zod schema before writing      |

Token fields on `UsageRecord` are **disjoint**: input, output, reasoning, cache read and cache
write never include each other, so their sum is the true total. Parsers must normalise to this
(OpenAI reports cached input inside input and reasoning inside output; subtract before
storing). Sums over 2³¹ were checked to come back exact.

Delete behaviour: deleting a project or milestone that still has tasks/milestones is
**blocked** by the database (Restrict). The only delete path is the project service's
`deleteProject` (ADR-013), which removes the project's tasks and milestones explicitly in one
transaction; dependencies and comments cascade with their tasks. Optional links (repo→project, session→project, task→
milestone, activity→anything) become null. Events and usage are deleted only with their
session.

### `packages/shared` — contracts (Phase 5)

- Zod schemas and inferred types shared by web and bridge: bridge API payloads, normalised
  session/usage records (Phase 5), action proposals (Phase 9). One file, `src/index.ts`.
- No runtime dependencies besides Zod. No I/O.
- Shipped as TypeScript source: Next compiles it (`transpilePackages`), and Node runs it
  directly (type stripping, Node ≥ 22.18), so there is no build step.

### `apps/bridge` — Agent Bridge (Windows host, Node + TypeScript, Phase 5)

- Runs on the host, not in Docker, because it needs the Windows filesystem, local git repos,
  and PowerShell. Plain Node runs its `.ts` files; config is `apps/bridge/.env`, checked by
  `src/config.ts`.
- **Ingestion:** reads Claude Code transcripts (`%USERPROFILE%\.claude\projects\<folder>\*.jsonl`)
  and Codex rollouts (`%USERPROFILE%\.codex\sessions`) in approved folders, and runs
  `claude agents --json` for Claude Code live status (see "Claude Code monitoring" and "Codex
  monitoring").
- **Execution (Phase 9):** will poll the web app for _approved_ actions, run them under the
  rules in ADR-005, and report output and exit codes back. Until then it runs nothing but the
  fixed live check.
- **Has no listening port.** It is a client only (ADR-003).

### PostgreSQL (Docker)

- Single database, named Docker volume for persistence.
- Schema changes only through Prisma migrations.

## Data flow

1. **Sessions/usage:** session file → bridge parser (Zod-validated, tolerant of unknown
   records) → `POST /api/bridge/ingest` → upsert keyed by source + session id + record id, so
   re-ingesting the same file is idempotent.
2. **Costs:** estimated in the web app from stored token counts × the user's versioned price
   table (per model, with effective dates), when a page is read. Usage without a price has no
   estimate, never $0. Billed cost isn't read from anywhere (ADR-019).
3. **Timeline:** derived from stored events (sessions, commits/PRs from GitHub, task changes,
   action runs). Never synthesised.
4. **Orchestration:** agent or user proposes an action → stored as `pending` → user approves
   or rejects in the UI → bridge picks up `approved` → `running` → `succeeded` / `failed`,
   with full audit trail.

## Security model

- **Network:** every port binds to `127.0.0.1`: Next.js runs with `--hostname 127.0.0.1`, and
  compose publishes `"127.0.0.1:55432:5432"`, never `"55432:5432"`. No reverse proxy, tunnel,
  or remote access.
- **Single user:** no login screen (it's the user's own machine on loopback). The bridge API
  is the exception — it requires `ADCC_BRIDGE_TOKEN` as a bearer token, compared in constant
  time, so other local processes can't inject data or pick up actions.
- **Browser-side CSRF/DNS-rebinding:** `src/proxy.ts` answers 403 unless `Host` (and
  `Origin`, when sent) is a loopback name (`127.0.0.1`, `localhost`, `[::1]`, any port), for
  every request, reads included, since pages show private GitHub data. Added in Phase 4: until
  then this line described a check that didn't exist. Next's own Server Action check
  (`Origin` = `Host`) remains underneath.
- **Secrets:** `apps/web/.env` only, validated by a Zod env schema at startup; the app
  refuses to start on invalid config, and validation errors name the bad key, never its value.
- **GitHub (ADR-016):** only a fine-grained PAT is accepted, with read-only repository
  permissions. It lives in `.env`, is read by server code only, and is sent only to
  `GITHUB_API_URL` (https, or http on loopback for tests). The adapter can only `GET`, so ADCC
  never changes anything on GitHub.
- **Agent Bridge (ADR-017):** `ADCC_WEB_URL` must be http on loopback, so the token and session
  metadata never leave the machine. The ingest route answers 503 without a configured token
  and 401 without the right one (SHA-256 both, then `timingSafeEqual`). It requires
  `Content-Length` (411), caps bodies at 8 MB, and Zod-validates every field with length
  limits. Error messages never echo the token. The bridge reads only approved folders, sends
  only redacted metadata, never follows redirects, writes no file, opens no port, and runs only
  `claude.exe agents --json` (absolute path, `execFile`, `shell: false`, fixed arguments, run
  from the home folder without the bridge token in its environment). `read-only.test.ts` is a
  tripwire for changes to that. Any process running as the user can read the token, so such
  processes are trusted (ADR-006).
- **Command execution:** see ADR-005.

## Architecture Decision Records

Add new ADRs at the end. Never rewrite an accepted one — supersede it with a new ADR.

### ADR-001: pnpm monorepo with web, bridge and shared packages

- **Status:** Accepted (Phase 0)
- **Context:** The web app and the host-side bridge exchange data and must agree on its shape.
- **Decision:** One pnpm workspace: `apps/web`, `apps/bridge`, `packages/shared`.
- **Consequences:** One install, one lint/test/typecheck run. Shared contracts can't drift.
  Slight tooling overhead vs. a single package.

### ADR-002: Web and database in Docker; bridge on the host

- **Status:** Accepted (Phase 0). Web container deferred to Phase 10 by ADR-009.
- **Context:** The app must start reliably with one click and keep Postgres isolated, but
  session files, git repos and PowerShell live on the Windows host.
- **Decision:** Docker Compose runs `web` and `db`. The bridge is a plain Node process on the
  host started by the launcher script.
- **Consequences:** The container needs no Windows bind mounts of user home folders. The
  bridge needs Node on the host.

### ADR-003: Bridge is a client only (pull model)

- **Status:** Accepted (Phase 0)
- **Context:** Something must move data between the host and the container. Either the
  container calls a host service, or the host process calls the container.
- **Decision:** The bridge opens no port. It pushes ingested data to the web app and polls the
  web app for approved actions.
- **Consequences:** No host-side attack surface; no reliance on `host.docker.internal`.
  Action pickup has polling latency (a few seconds), which is acceptable for human-approved
  work.

### ADR-004: Session data is read from local files, never fabricated

- **Status:** Accepted (Phase 0)
- **Context:** Claude Code and Codex store sessions as local JSONL files whose formats are
  undocumented and change between versions.
- **Decision:** Parsers validate each line with Zod, skip and count unknown/invalid records
  instead of failing the whole file, and store the raw source path and offset for each record.
  Parser fixtures are real, redacted files committed under the parser's test directory.
- **Consequences:** Format changes degrade gracefully and visibly (a "skipped records" count),
  never silently or with invented values.

### ADR-005: Human-approved command execution

- **Status:** Accepted (Phase 0)
- **Context:** Orchestration means running AI-suggested commands on the user's machine.
- **Decision:**
  - Every command is an `Action` record with the exact command, working directory, origin
    (which agent/session proposed it), and status
    `pending → approved | rejected → running → succeeded | failed`.
  - Only the user can move `pending → approved`, in the UI, seeing the exact command text.
    Approval is bound to that exact text — any edit returns it to `pending`.
  - The bridge executes only `approved` actions, once, with no shell string interpolation of
    agent output; working directory must be inside a registered project folder.
  - Output, exit code, and timestamps are stored for audit. Nothing is auto-approved.
- **Consequences:** Slower than autonomous agents, by design.

### ADR-006: Localhost-only, single-user, no auth screen

- **Status:** Accepted (Phase 0)
- **Context:** Personal tool on one Windows machine.
- **Decision:** Bind to loopback, skip user accounts, protect the bridge API with a token and
  mutating routes with Host/Origin checks.
- **Consequences:** Must never be exposed beyond loopback; doing so would need auth first and a
  new ADR.

### ADR-007: Layered web app: domain, services, database, UI

- **Status:** Accepted (Phase 1)
- **Context:** Business rules (cost maths, approval state machine, parsing) must be testable
  without a database, and UI code must not grow ad-hoc queries.
- **Decision:** `src/domain` (pure), `src/server/db` (Prisma only here), `src/server/services`
  (use cases), `src/app` + `src/components` (UI). Enforced with `no-restricted-imports` in
  `apps/web/eslint.config.mjs`: domain can't import server/UI/framework/Prisma; UI can't
  import `src/server/db` or Prisma.
- **Consequences:** Pure logic is unit-tested directly; services are tested with the db module
  mocked. One more hop for simple reads, accepted.

### ADR-008: Data model conventions

- **Status:** Accepted (Phase 1). "Projects are archived, not deleted" superseded by ADR-013.
- **Context:** The database holds the user's only copy of tasks and ingested history.
- **Decision:**
  - UUIDv7 primary keys (`@db.Uuid`, time-ordered), `timestamptz(3)` for every timestamp,
    snake_case table names.
  - Foreign keys from user-authored children (tasks, milestones) to projects are `Restrict`.
    Projects are archived (`archivedAt`), not deleted.
  - Idempotency lives in unique constraints (`(source, externalId)`,
    `(sessionId, externalId)`, `dedupeKey`), so ingestion can retry safely.
  - Invariants Prisma can't express are hand-written CHECK constraints in migration SQL.
  - Cost is never stored; it's derived from token counts and a price table (Phase 7).
  - Event/type names coming from external tools are `varchar`, not enums, so a new agent
    record type never breaks ingestion.
  - Task-milestone same-project rule is enforced in the task service (Phase 3), not by FK.
- **Consequences:** Accidental deletes fail loudly. `prisma migrate dev` won't detect drift in
  CHECK constraints, so they must be kept in migrations by hand.

### ADR-009: Web runs on the host until Phase 10; Postgres on port 55432

- **Status:** Accepted (Phase 1)
- **Context:** Docker could not run on the dev machine when Phase 1 was built (WSL not
  installed), so a web container could not be tested. During Phase 1 another local project
  was found listening on `127.0.0.1:5432` and accepting any password, so ADCC silently
  connected to the wrong database.
- **Decision:** Phase 1 runs only Postgres in compose. The web container (Dockerfile, compose
  service) moves to Phase 10 with the launcher, where it can be tested end to end. Postgres is
  published on host port `55432`, so a clash fails loudly at `docker compose up` instead of
  connecting elsewhere. One env file, `apps/web/.env`, is read by Next.js, the Prisma CLI and
  compose (`env_file`).
- **Consequences:** Until Phase 10 the developer starts the web app with `pnpm dev`. Containers
  reach Postgres on 5432 internally; the host uses 55432.

### ADR-010: Postgres sessions are pinned to UTC

- **Status:** Accepted (Phase 2)
- **Context:** While verifying Phase 2 against a non-UTC Postgres, every timestamp came back
  shifted by the server's UTC offset. The Prisma `pg` driver adapter drops the offset when it
  parses `timestamptz`, so it is only correct when the session time zone is UTC. The Docker
  `postgres` image defaults to UTC, which hides the bug until someone changes it.
- **Decision:** `src/server/db/client.ts` passes `options: "-c TimeZone=UTC"` so every
  connection starts in UTC, whatever the server default. Display formatting stays local.
- **Consequences:** Timestamps are correct on any Postgres configuration. If the adapter is
  replaced or fixed, this line can go, but it is harmless to keep.

### ADR-011: Missing data is shown as missing

- **Status:** Accepted (Phase 2)
- **Context:** The dashboard must never fabricate metrics, and several sources (GitHub, agent
  sessions, usage) don't exist until later phases. A failed read must not look like "0".
- **Decision:**
  - A failed read becomes `DataUnavailable` with the real error, via `load()`; the error
    boundary (`app/error.tsx`) is only for unexpected render bugs.
  - A metric with no source renders "—" (`StatCard` with `value: null`), not 0. Zero is shown
    only when the database answered zero.
  - Empty integrations say which phase brings them. Cost is not shown until it can be
    calculated from a price table (Phase 7).
  - Charts are deferred until there is real data to plot.
- **Consequences:** Pages are honest but sparse until later phases land. Every page has three
  tested states: data, empty, unavailable.

### ADR-012: Blocked is derived from dependencies; started work needs finished dependencies

- **Status:** Accepted (Phase 3)
- **Context:** Phase 3 adds task dependencies and a five-column board (Backlog, To do, In
  progress, In review, Completed). A stored `BLOCKED` status would duplicate what the
  dependencies already say, and could disagree with them.
- **Decision:** `TaskStatus` is `BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, DONE, CANCELLED`
  (Cancelled stays off the board). A task is _blocked_ when it is unfinished and a dependency
  is neither done nor cancelled; that's computed, never stored. A task can't enter In progress,
  In review or Completed while blocked (`assertStatusAllowed`). Dependencies must be in the same
  project and may not form a cycle (`createsCycle`). `completedAt` is set when a task first
  becomes done and cleared when reopened. Moving a dependency backwards doesn't move its
  dependents back; they just show as blocked.
- **Consequences:** The board can't get into a state the dependencies contradict. Removing the
  enum value was a destructive migration, approved by the user with 0 affected rows; the cast
  fails loudly rather than guessing if a `BLOCKED` row ever exists.

### ADR-013: Projects can be deleted, only once archived and confirmed by name

- **Status:** Accepted (Phase 3). Supersedes ADR-008's "archived, not deleted".
- **Context:** The user asked to be able to delete projects. CLAUDE.md requires explicit
  approval for each deletion of user data.
- **Decision:** Archiving makes a project read-only (no edits to it, its tasks, milestones,
  comments or repositories). Only an archived project can be deleted, and only after typing
  its exact name in a dialog that says how many tasks and milestones go with it. The service
  deletes tasks, milestones and project in one transaction; repositories and timeline entries
  are kept and unlinked, and a `project.deleted` event records what was removed. Tasks have no
  delete of their own: cancel them.
- **Consequences:** Two deliberate steps per deletion; the FK `Restrict` rules still stop any
  other code path from deleting a project with children.

### ADR-014: E2E runs a production server against its own database

- **Status:** Accepted (Phase 3)
- **Context:** Phase 3 e2e must create and change rows, which must never touch the dev
  database. Also, Next allows one `next dev` per app folder, so a running `pnpm dev` blocked
  Playwright's own dev server.
- **Decision:** Playwright's global setup derives an `adcc_e2e` database from `DATABASE_URL`,
  creates it if missing, runs `prisma migrate deploy`, and truncates it (refusing any database
  not named `adcc_e2e`). The web server is `next build && next start` on 3100 with
  `DATABASE_URL` pointed there. If Postgres is unreachable, setup says so and the database
  flows skip; the rest still runs.
- **Consequences:** E2E tests the production build and coexists with `pnpm dev`, at the cost of
  a build per run (~1 min). A production server answers before hydration, so tests retry the
  first click on a page (`e2e/helpers.ts`).

### ADR-015: GitHub data is a read-only cache, replaced whole on each sync

- **Status:** Accepted (Phase 4)
- **Context:** Phase 4 shows branches, commits, PRs with review status, issues and workflow
  runs for linked repositories, with manual refresh, background sync, and the last successful
  sync and error. GitHub is the source of truth; ADCC must not invent or estimate any of it,
  and must stay inside GitHub's rate limits.
- **Decision:**
  - A separate adapter (`server/github/client.ts`) is the only GitHub code; it can only `GET`.
    Everything it returns is Zod-validated and normalised in `domain/github.ts`.
  - Five cache tables (`github_branches`, `github_commits`, `github_pull_requests`,
    `github_issues`, `github_workflow_runs`), keyed by repository plus GitHub's natural key,
    hold the last successful sync. A sync replaces a repository's rows in one transaction, so
    pages never mix two syncs. These rows aren't user data; rule 5 doesn't cover replacing them.
  - Sync state is persistent on `Repository`: `lastSyncedAt` (success), `lastSyncAttemptAt`,
    `lastSyncError`, `syncFailures`. A failure never clears the last good data.
  - Values GitHub defines (states, conclusions, events) are `varchar`, per ADR-008, with CHECKs
    only on the PR/issue states ADCC itself derives.
  - Timeline entries are written once per real GitHub event, deduplicated by key.
  - Background sync runs in the web process (started by `instrumentation.ts`), one repository
    at a time, with backoff and a pause on rate limits or a rejected token. Off when
    `GITHUB_SYNC_INTERVAL_MINUTES=0`.
- **Consequences:** Pages read only the database, so they work (with stale data and the error
  shown) when GitHub is down. Lists are capped at one page per endpoint (`shortcut:` in the
  adapter). The in-process lock assumes one server process; a second process would need a
  database lock. Review status is ADCC's count of reviewer verdicts, not GitHub's merge rule.

### ADR-016: Fine-grained, read-only GitHub token from .env only

- **Status:** Accepted (Phase 4)
- **Context:** The user asked for least privilege, read-only access, tokens kept server-side,
  and handling of revoked credentials. The installed `gh` CLI is signed in with an OAuth
  token that has `repo` and `workflow` scopes, which allow writes.
- **Decision:** `GITHUB_TOKEN` must be a fine-grained PAT (`github_pat_…`); classic and OAuth
  tokens fail env validation at startup. DEVELOPMENT.md lists the read-only permissions to
  grant. The token is not taken from `gh` and is not stored in the database or entered in the
  UI. A 401 is shown as "revoked or expired" with what to do; background sync stops until
  restart. `GITHUB_API_URL` exists so e2e can point at a loopback mock and must be https
  otherwise.
- **Consequences:** Connecting means creating a token on github.com and restarting ADCC: one
  more step than reusing `gh`, but the token can't write and is limited to chosen repos.
  `gh` was used only to record the test fixtures.

### ADR-017: Claude Code monitoring from documented live status plus best-effort transcripts

- **Status:** Accepted (Phase 5)
- **Context:** Phase 5 must show Claude Code sessions with status, model, start and last
  activity, tool activity, token usage and errors, read-only, without claiming a session is
  running when that can't be verified. The interfaces available in Claude Code 2.1.296, per its
  docs:
  - `claude agents --json` lists live sessions with `sessionId`, `cwd`, `startedAt` and `status`
    (busy, waiting or idle). The docs call it "the supported way to read session state from
    outside Claude Code".
  - Transcripts in `~/.claude/projects/<folder>/<session>.jsonl` have a documented location, but
    the docs say the entry format "is internal to Claude Code and changes between versions".
  - Hooks give lifecycle and tool events, but no token usage, and the model only sometimes on
    SessionStart. They also need entries in the user's global Claude Code settings.
  - The status line runs only while a session renders.
  - OpenTelemetry has exact per-request tokens, but needs a receiver listening on a port.
  - The Agent SDK's `listSessions`/`getSessionMessages` return the same raw transcript records
    and would add a large dependency.
- **Decision:**
  - Live status comes only from `claude agents --json`, run by the bridge each poll. It runs
    `claude.exe` through `execFile` with `shell: false`, fixed arguments and a 15 s timeout.
    This is the bridge's only process launch. It is not a general command runner and takes no
    input, so ADR-005 doesn't apply to it.
  - Everything else comes from transcripts, parsed by loose Zod schemas. Unrecognised records
    are counted, never guessed at (ADR-004), and fixtures are real, redacted records. Tokens
    are keyed by message id because each content block repeats the response's usage. Thinking
    tokens are split out of `output_tokens` to keep counts disjoint.
  - The bridge sends metadata only. No prompt, response, thinking, tool input or output leaves
    it, except the first line of an error, after secret-shaped masking and clipping to 200
    characters. It reads only transcripts whose first recorded `cwd` is inside
    `BRIDGE_APPROVED_FOLDERS`.
  - Status is computed when a page is read: _running_ / _not running_ only from a fresh,
    successful live check, otherwise _unverified_ with last observed activity. It is never
    inferred from recent activity. No schema change: the latest bridge report is one
    `ApplicationSetting` row, and models come from `UsageRecord`.
  - Hooks, OpenTelemetry, the status line and the SDK are not used.
- **Consequences:** No setup inside Claude Code; the user only runs the bridge. A Claude Code
  update can change the transcript format. The effect is a rising "records not recognised"
  count and missing data, never wrong data; fixing it means updating the parser. `endedAt` stays
  unused, because nothing documented reports a session's end except its absence from the live
  list. Status is only as fresh as the poll interval, and only while the bridge runs.

### ADR-018: Codex monitoring from rollout files, with no live status

- **Status:** Accepted (Phase 6)
- **Context:** Phase 6 adds Codex to the AI Agents page, read-only, without assuming Codex
  exposes what Claude Code does. Inspected on this machine: the Codex desktop app and VS Code
  extension (Codex 0.162), no `codex` CLI on `PATH`. Codex keeps sessions as
  `~/.codex/sessions/<date>/rollout-*.jsonl`, thread names in `session_index.jsonl`, and other
  state in SQLite databases. None of it is documented as an interface, and there is no
  documented way to list running sessions (the app-server protocol needs a running `codex`
  binary and drives sessions rather than observing them). The rollout format differs from
  Claude Code's, and the two clients write different record styles: the desktop app uses
  `item_completed` items, the VS Code extension `user_message` / `patch_apply_end` events.
  Fork and subagent rollouts start with a copy of the parent's history.
- **Decision:**
  - A dedicated adapter (`codex-rollout.ts`) behind a small `Provider` interface the scanner
    already drives; both tools share one normalised event contract, extended with
    `operation.completed`, `turn.completed` and `turn.aborted`, plus a `source` and labelled
    `details` per session (one additive, nullable column).
  - Read rollouts and the session index only; never the SQLite files, never a process. The
    bridge's only process launch is still `claude agents --json`.
  - Usage only from `token_usage_record` whose `thread_id` is the session (copied history
    belongs to the parent), with the model from that turn's `turn_context`; never from the
    running `token_count` totals. Both record styles are read, keyed so one operation can't
    count twice.
  - No live status: Codex sessions are always _unverified_ with last observed activity. Recent
    activity is not treated as proof of running. `PROVIDER_CAPABILITIES` (web domain) states
    per tool what is and isn't available, so the UI can say "not available" rather than 0.
  - Stricter redaction than Claude Code: no command or tool output text at all; failures
    carry the tool name and exit code only.
  - Each provider is listed in isolation and reports its own status in the heartbeat.
- **Consequences:** Codex works with no setup. A Codex update can change the format; the
  effect is a rising "records not recognised" count, never invented data. Checked against
  all 77 rollouts on this machine: 0 unrecognised records, and parsed usage matched an
  independent count from the raw files (2,473 responses). Live status for Codex stays
  unavailable until Codex documents an interface for it.

### ADR-019: Usage costs are user-priced estimates; billed cost is not read

- **Status:** Accepted (Phase 7)
- **Context:** Phase 7 adds usage analytics with costs and budgets, and must keep apart
  verified token usage, estimated API-equivalent cost, actually billed cost, and subscription
  usage with no per-token charge, never presenting an estimate as a charge or hardcoding
  unverified prices. The token counts are verified (ADR-017, ADR-018), but nothing ADCC reads
  carries a price or a charge. Claude Code and Codex can run on a subscription or an API key,
  and neither's session files say which. Provider billing data exists only behind
  organisation admin APIs (Anthropic's Admin API cost report, OpenAI's organisation costs),
  which need an admin key and outbound calls, and say nothing about subscription plans.
- **Decision:**
  - Prices are user-entered versions in `model_prices`: exact model id, effective-from day,
    USD per million tokens. Input and output are required; cache read, cache write and
    reasoning are optional, and a blank rate means unknown. Every version needs a source;
    assumptions are optional. ADCC ships, fetches and guesses no prices.
  - Cost is estimated when read (never stored, ADR-008): each kind of token × its rate in the
    version in force on the usage's day. No version, or tokens of a kind without a rate, means
    no estimate. Sums carry the unpriced token count, so a total is shown as a lower bound
    ("≥") or "No price", never as $0, and every cost label says "estimated API-equivalent".
  - Billed cost isn't obtained. Connecting admin billing APIs would add an organisation admin
    credential and new outbound calls, and still wouldn't cover subscriptions. The UI says
    billed cost is not available instead.
  - The user states each tool's billing type (API key / subscription / not set) and monthly
    budgets (tokens and/or estimated cost, with a warning percentage) in one
    `application_settings` row, `analytics.settings`, validated on write and on read. Budgets
    compare month to date.
  - Days, weeks (from Monday) and months are calendar periods in the server's time zone,
    which is the user's own machine. Price effective dates are days in the same zone.
  - Price changes write `pricing.*` activity events in the same transaction.
- **Consequences:** Nothing is estimated until the user adds prices; the settings page lists
  recorded models with none. Model ids must match exactly, so a new model version is unpriced
  until added, which is visible rather than wrong. Discounts, batch rates, regional pricing,
  long-context tiers, cache-write durations, taxes and credits aren't modelled; that goes in a
  price's assumptions. When the web app moves into a container (Phase 10) it must run with the
  host's `TZ`, or days will be UTC days.
