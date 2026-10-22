# Roadmap — ADCC

Work proceeds one phase at a time. A phase is done only when every box is ticked and the
validation gate has run. Start a phase only when asked.

**Validation gate (every phase from 1):** `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, and `pnpm test:e2e` where applicable. Record anything that could not run under
the phase's _Notes_.

**Current phase:** Phase 6 complete → next is Phase 7.

Phase numbering changed in Phase 2: the dashboard interface was inserted as Phase 2, so every
later phase moved up by one.

---

## Phase 0 — Foundation docs ✅

- [x] CLAUDE.md — agent rules and conventions
- [x] ARCHITECTURE.md — components, data flow, security model, ADR-001..006
- [x] ROADMAP.md — phases and checklists
- [x] DEVELOPMENT.md — setup, commands, workflow
- [x] `.gitignore` covering `.env`, build output, dependencies

Notes: no code exists, so lint/typecheck/test/build were not applicable.

## Phase 1 — Application foundation ✅

- [x] pnpm workspace with `apps/web` (bridge and shared package moved to Phase 5)
- [x] Next.js 16 App Router + React 19 + TypeScript strict (`noUncheckedIndexedAccess`)
- [x] Tailwind CSS 4 + shadcn/ui (button, card, badge)
- [x] ESLint (Next + Prettier-compat + layer-boundary rules) and Prettier
- [x] Root `lint`, `typecheck`, `test`, `build`, `test:e2e`, `format`, `db:*` scripts
- [x] PostgreSQL 17 in `docker-compose.yml` (loopback, port 55432, named volume, healthcheck)
- [x] Prisma 7 + `pg` adapter; models Project, Repository, Milestone, Task, AgentSession,
      AgentEvent, UsageRecord, ActivityEvent, ApplicationSetting with relations, indexes,
      unique and CHECK constraints
- [x] Committed initial migration `20261021000000_init`; `db:migrate` / `db:deploy` / `db:status`
- [x] Layers: `domain` / `server/services` / `server/db` / UI, enforced by ESLint (ADR-007)
- [x] Zod env schema; server refuses to start on invalid env
- [x] `GET /api/health` (200 ok / 503 degraded with per-check detail)
- [x] App shell: sidebar nav (unbuilt sections marked with their phase), dashboard with live
      system status and an honest empty state
- [x] `apps/web/.env.example`, root `.gitignore`
- [x] Vitest (5 unit tests) and Playwright (2 e2e tests on its own port 3100)
- [x] Validation gate: lint, typecheck, test, build, test:e2e all pass

Notes:

- At first Docker could not run (WSL missing), so the migration was first checked on PGlite:
  all 9 tables created, and Restrict / CHECK / unique constraints each rejected a bad row.
- **Re-verified 2026-10-21 on Docker Postgres 17** (blocker resolved): `adcc-db` container
  healthy on `127.0.0.1:55432`, `pnpm db:status` reports the init migration applied and the
  schema up to date, 9 tables + `_prisma_migrations`, all 3 hand-written CHECK constraints,
  12 foreign keys, 19 unique indexes. `/api/health` returns 200 `ok` with `database: up`.
  Full gate re-run: lint, typecheck, test (27), build, test:e2e (29, against the running dev
  server because Next allows one `next dev` per app directory).
- Dev startup verified: `next dev` boots, renders the shell, and `/api/health` returns 503
  `degraded` (database unreachable); with no `.env` the server refuses to start and names the
  bad variable.
- Another local project (`maplestory-clone`) runs a PGlite server on `127.0.0.1:5432` that
  accepts any password, and its Next dev server holds port 3000. Hence ADR-009's port 55432 and
  e2e's port 3100. While that project runs, `pnpm dev` on 3000 will fail to bind.

## Phase 2 — Dashboard interface ✅

- [x] Dark-first theme (charcoal, blue/violet accents) with light and system modes; tokens in
      `globals.css`, `success`/`warning` added; reduced-motion respected
- [x] App shell: collapsible icon sidebar (state kept in a cookie, Ctrl+B, sheet on mobile),
      sticky top bar, skip link
- [x] Global search: Ctrl+K command palette over pages, theme actions, and project/task names
      (server action, Zod-validated, debounced)
- [x] Notification area fed by the live health check
- [x] Theme menu in the top bar and theme settings page
- [x] Loading (skeleton), empty, data-unavailable, error and not-found states
- [x] Pages: Overview, Projects, Tasks (status filter), AI Agents, GitHub, Analytics, Activity,
      Settings — all read real database rows; nothing estimated or invented
- [x] Overview: total projects, active tasks, connected agents (24 h), recent activity, project
      completion, 30-day token usage, GitHub summary; "—" when a source doesn't exist yet
- [x] Reusable components: `PageHeader`, `StatCard`, `EmptyState`, `DataUnavailable`, status
      badges
- [x] Unit tests: task maths, overview aggregation, `load()`, search validation, relative time
- [x] E2E: navigation and `aria-current`, page states, sidebar collapse/persist/shortcut,
      command palette, theme persistence, notifications, mobile sheet, 404, status filter
- [x] Accessibility: axe WCAG 2.1 A/AA scan of every page and the palette in both themes
- [x] Validation gate passes

Notes:

- Built before Docker worked (see Phase 1). Pages were verified against real
  rows by running the committed migration on a throwaway PGlite server in a scratch folder,
  seeded with fixture rows: all pages rendered correctly, counts matched the seed, and axe
  found 0 violations in both themes with data present. That data never touched the app DB.
- Found and fixed while verifying: the Prisma `pg` adapter drops the UTC offset when the
  Postgres session isn't UTC, shifting every timestamp. The client now pins `TimeZone=UTC`
  (ADR-010). Verified the symptom and the cure on PGlite; the startup option itself is
  honoured by real Postgres but not by PGlite. Confirmed on Docker Postgres 17 (2026-10-21):
  a session started with `-c TimeZone=Asia/Seoul` reports `Asia/Seoul`, so the UTC pin
  takes effect.
- Charts (Recharts) are deferred to Phase 7, when there is usage data to draw. Analytics shows
  exact token counts per model in a table.
- E2E runs with the database down, so it checks the unavailable/empty states; populated
  states were checked manually as above.
- Independent code review fixes: Reasoning column added so Analytics cells sum to Total;
  token fields documented as disjoint; due dates formatted in UTC (no off-by-one-day);
  "Connected agents" renamed "Agents active · 24 h"; top model ranked by tokens, not calls;
  stale search responses dropped; search results navigate fully so the row is highlighted;
  "—" announced as "Not available" to screen readers; `global-error.tsx` added. Token sums
  past 2³¹ verified exact on PGlite.

## Phase 3 — Project management ✅

- [x] Migration `20261022000000_project_management`: `Project.status`, `Task.assignedAgent`,
      `TaskStatus` gains `IN_REVIEW` and loses `BLOCKED` (derived now, ADR-012; 0 rows
      affected), new `TaskDependency` and `TaskComment` tables, CHECKs for no self-dependency
      and non-blank comments
- [x] Projects: create, edit (name, description, status, local folder), archive/unarchive,
      delete (archived only, typed-name confirmation, ADR-013); GitHub repository link/unlink
      by `owner/name` or URL (stored, not synced: sync is Phase 4)
- [x] Project detail dashboard: completion, task and milestone counts, Kanban board,
      milestones with completion %, repositories, recent activity
- [x] Tasks: create/edit title, description, status, priority, due date, milestone, optional
      AI provider (assignment only, nothing runs), dependencies; comments; history from
      activity events
- [x] Kanban: Backlog / To do / In progress / In review / Completed; native drag-and-drop plus
      a keyboard "Move" menu on every card; optimistic moves that roll back if refused
- [x] Milestones: create/edit, due date, status, task association, completion %
- [x] Rules in the service layer: archived projects read-only; milestone and dependencies in
      the task's project; no cycles; no starting a task with unfinished dependencies
- [x] Every mutation is a Zod-validated Server Action writing an `ActivityEvent` in the same
      transaction
- [x] Tasks page: search, project/priority/AI-provider filters, status tabs, pagination (25);
      Projects page: search, status filter, active/archived views, pagination; palette results
      open the detail pages
- [x] Unit tests (135 total): validation, slugs, Windows paths, repo refs, transitions,
      cycles, change descriptions; service CRUD and permission rules with the db mocked
- [x] E2E (33 total) on a separate `adcc_e2e` database (ADR-014): project CRUD/archive/delete,
      milestones, repositories, dependencies blocking the board, drag-and-drop, comments,
      history, filters, axe on the new pages and dialogs in both themes
- [x] Validation gate passes

Notes:

- "Permissions" means business rules: ADCC is single-user with no login (ADR-006), so there
  are no roles to test. Tested rules: archived read-only, delete preconditions,
  cross-project milestone/dependency refusal, cycles, blocked transitions.
- No task delete: the request asked for create/edit. Cancel a task instead; tasks go only with
  their project.
- Found and fixed: the light-theme `--success` token was 4.42:1 on white (below AA). It never
  showed in Phase 2's e2e because no green badge rendered without data. Now 5.3:1.
- E2E now runs against `next build && next start` on 3100 instead of `next dev`, because
  Next allows one dev server per app folder and a running `pnpm dev` blocked it. A production
  server answers before hydration, so first clicks after a page load retry until the
  dialog/menu opens (`e2e/helpers.ts`).
- Docker Desktop stopped by itself mid-session. That gave a real database-down run (29 passed,
  4 database flows skipped). After restarting it, two full runs with the database up: 33/33.
- Shortcut: the board loads every board task of a project (no per-column paging).
- Shortcut: dependency/cycle checks run before the write transaction; two tabs saving A→B and
  B→A at the same instant could both pass. Acceptable for one local user (comment in
  `task-service.ts`).
- Independent code review fixes: dependency changes compared by id, not title (a swap between
  same-titled tasks was silently dropped); the started-needs-finished-dependencies rule runs
  only when status or dependencies change, so a task stays editable after a dependency is
  reopened (it shows as blocked); the archive flag from the client is Zod-validated; milestone
  saves with no change write nothing and log what changed; a page past the end says so; board
  announcements use two fixed live regions; clearer message for a repository held by an
  archived project.

## Phase 4 — GitHub integration (read-only) ✅

- [x] Fine-grained PAT via `.env` (`GITHUB_TOKEN`), validated at startup; classic and OAuth
      tokens refused (ADR-016); setup steps and read-only permissions in DEVELOPMENT.md
- [x] Connect: GitHub page shows the account, token expiry, remaining API quota and
      background-sync interval; "not connected" with setup steps when there's no token
- [x] List repositories the token can read and link them to projects (Phase 3 link rules)
- [x] Migration `20261023000000_github_sync`: sync state on `Repository`, cache tables for
      branches, commits, PRs, issues, workflow runs (ADR-015), with CHECKs
- [x] Repository page: branches, recent commits, PRs with derived review status, issues,
      workflow runs, and a repository activity timeline (deduplicated `ActivityEvent`s)
- [x] Manual refresh per repository and "Sync all"; controlled background sync
      (`GITHUB_SYNC_INTERVAL_MINUTES`, backoff on failures, pause on rate limit / 401)
- [x] Last successful sync, last attempt and last error shown per repository; failures keep
      the last good data
- [x] Separate GET-only adapter; Zod-validated, normalised responses; retries on 5xx and
      network errors; typed errors for 401/403/404/rate limits; token never logged or shown
- [x] Tests with recorded fixtures (no live network in tests): adapter and sync service
      integration over mocked HTTP, domain rules; e2e against a loopback mock GitHub
- [x] Validation gate passes

Notes:

- Inspected tools first: `gh` 2.102 is signed in, but with an OAuth token scoped `repo`,
  `workflow` (write access), so ADCC doesn't use it (ADR-016). `gh api` recorded the fixtures
  from the public `octocat/Hello-World`.
- Real-data check: with the `gh` token passed straight to the adapter (bypassing env
  validation, for this check only), live syncs of `octocat/Hello-World`, `cli/cli` and the
  user's own empty repository all parsed, and a sync into the `adcc_e2e` database wrote 30 PRs,
  7 runs, 10 issues and 67 timeline events; a second sync added none. This found a real bug:
  GitHub answers an empty repository's commits with 409, now handled.
- The app itself hasn't been run against real GitHub with a fine-grained token, because
  creating one needs the user on github.com. Once `GITHUB_TOKEN` is set, open `/github`.
- Shortcut: one page per endpoint (100 repos/branches, 30 commits/PRs/issues, 20 runs, reviews
  for 20 open PRs). Shortcut: in-process sync lock (one server process).
- Review status counts reviewer verdicts; it doesn't know branch-protection rules.
- Independent code review and security audit fixes: open PRs fetched separately (the open
  count had come from the 30 most recently updated PRs; live `cli/cli`: 59 open); issues
  skipped when turned off (410) and the empty state says what was checked; timeline keys use
  GitHub's repo id, and sync follows renames (a rename had duplicated every event); strings
  clipped to column sizes; https-only links; every 429 and rate-limit 403 recognised, with a
  60 s fallback (a missing reset header had thrown); a known rate limit blocks manual refresh
  too; rate limits and 401s don't add to a repository's backoff; sync lock on `globalThis`;
  a blank sync interval means the default.
- Security audit found the documented Host/Origin check (DNS rebinding) had never been
  written. Added `src/proxy.ts`: 403 unless Host/Origin are loopback, for every request.
  Earlier-phase gap, fixed now because GitHub pages show private repository data.
- E2E: the GitHub and Activity pages now stream long enough that Playwright could see React's
  hidden streaming chunk as a second match; queries on those pages are scoped to `#main`.

## Phase 5 — Agent Bridge + Claude Code sessions ✅

- [x] Create `packages/shared` (Zod contracts) and `apps/bridge` workspace packages
- [x] `apps/bridge` host process; config via `.env`; bearer token auth
- [x] `/api/bridge/ingest` route with shared Zod contract
- [x] Claude Code JSONL parser: sessions, messages, token usage, model; unknown records counted
- [x] Idempotent upsert (re-ingest causes no duplicates)
- [x] Sessions list/detail UI, mapped to projects by working directory
- [x] Parser tests against real redacted fixtures
- [x] Validation gate passes

Also delivered (from the Phase 5 request):

- [x] Live session status from `claude agents --json`, the documented interface. Shown as
      _Running · Busy/Idle/Waiting_ only from a current, successful check; otherwise
      _Not running_ (check current) or _Unverified_ with last observed activity and the reason
- [x] Approved project folders (`BRIDGE_APPROVED_FOLDERS`); narrowly scoped reads; redaction
      of everything but tool names, titles and one masked error line
- [x] Tool activity (names), tool and API errors, token usage per model, model, start and last
      activity, session activity timeline (latest 200 events)
- [x] Agent overview, session list, session detail, connection status card, data freshness
      (last report and live-check times)
- [x] Read-only: the bridge runs only `claude.exe agents --json`, writes nothing, opens no port
      (`read-only.test.ts`); no remote command execution
- [x] Limitations documented (DEVELOPMENT.md); ADR-017

Notes:

- Researched first, from the docs for the installed Claude Code 2.1.296 (transcripts on disk
  were written by 2.1.304). `claude agents --json` is documented as the supported way to read
  session state from outside. The transcript location is documented, but its format is
  explicitly internal and unstable. Hooks carry no token usage and need edits to global
  settings. OpenTelemetry needs a receiver port. The Agent SDK's session reader returns the
  same raw records. Hence ADR-017: live status from the documented command, everything else
  best-effort from transcripts.
- No schema migration: the latest bridge report is one `ApplicationSetting` row, models come
  from `UsageRecord`, and status is computed when a page is read. `AgentSession.endedAt` stays
  unused, because nothing documented reports a session's end.
- Node ≥ 22.18 is now required: the bridge and `packages/shared` run as TypeScript with no
  build step (type stripping). The web `tsconfig` allows `.ts` import extensions for this.
- Real-data check, on an isolated server (port 3200, `adcc_e2e` database, throwaway token
  passed as an environment variable; no `.env` or dev database touched). The real bridge read
  this project's 4 real transcripts:
  - 602 unique responses and 142,440,545 tokens, an exact match with an independent count
    from the raw files deduplicated by message id;
  - errors, tool uses and prompts per session also matched;
  - live status matched `claude agents --json` (this session _Running · Busy_, three
    _Running · Idle_);
  - a bridge restart re-sent everything and added only the records written in between;
  - stored free text was only tool names with exit codes and one API notice.
- Found by running on real data:
  - Transcript `cwd` follows every shell `cd`, so sessions now keep the folder they started in.
  - 341 message ids on this machine appear in more than one transcript (resumed and forked
    sessions). Usage is now stored once across sessions.
  - Many user records aren't prompts (task notifications, relays, command echoes). Prompts
    are now `origin.kind: "human"`; a first "starts with `<`" rule wrongly dropped real
    prompts wrapped in tags.
- Independent code review and security audit fixes:
  - A new report could carry an old live check, so the live check's own time must now be
    current too.
  - A heartbeat goes first each cycle; files are read one at a time, at most 16 MB per read;
    a rejected file is skipped and reported, not left blocking the rest.
  - The skipped-record count is the latest total (it could never go down).
  - Redaction misses fixed: `--password x`, `DB_PASS=`, cookies, Stripe/Slack/npm/JWT shapes,
    shorter mixed keys. Titles are now redacted, and control and bidi characters dropped.
  - `..` and `\\?\` paths are refused by folder containment.
  - The live check runs from the home folder without the bridge token in its environment;
    `CLAUDE_EXE` must be absolute; the bridge never follows redirects.
  - Ingest requires `Content-Length`.
  - Config limits match the contract.
  - Codex sessions will never read Claude's live check.
- Shortcuts:
  - Bridge offsets are in memory, so a restart re-reads every approved transcript.
  - Session creation is find-then-create, assuming one bridge.
  - Project mapping updates when a session's records arrive (or after a bridge restart).
  - Timeline capped at the latest 200 events; session list at 200.
- Not done:
  - `apps/bridge` and `packages/shared` have no ESLint run. They are covered by Prettier,
    `tsc --strict` and tests, and contain no `any`.
  - Subagent transcripts aren't read.
  - Session activity isn't written to the global Activity timeline (that's Phase 8).
- The bridge hasn't been run against the dev app, because that needs `ADCC_BRIDGE_TOKEN`
  added to your `apps/web/.env` and `apps/bridge/.env`. See DEVELOPMENT.md.

## Phase 6 — Codex sessions ✅

- [x] Codex JSONL parser into the same normalised format
- [x] Sessions UI shows both sources with a source filter
- [x] Parser tests against real redacted fixtures
- [x] Validation gate passes

Also delivered (from the Phase 6 request):

- [x] Inspected the installed Codex first (desktop app and VS Code extension, Codex 0.162; no
      CLI on `PATH`) and recorded what it exposes and doesn't (ADR-018)
- [x] Dedicated Codex adapter (`codex-rollout.ts`) behind a provider interface shared with
      Claude Code; the scanner, offsets, approved-folder check and sending are common
- [x] Sessions mapped to projects by working folder; model, branch, client, Codex version,
      subagent role and fork parent shown as provider details; titles from Codex's thread
      names
- [x] Last activity, with an honest _Unverified_ status (Codex has no live session check)
- [x] Token usage per response and model; errors, completed operations (commands, edits, MCP
      calls, searches) and turn outcomes; session activity timeline
- [x] Normalised events persisted through the existing idempotent upsert; one additive
      column, `agent_sessions.details`
- [x] Manual Refresh on the AI Agents page; tool filter (All / Claude Code / Codex)
- [x] Connection diagnostics per tool: folder, files found, readable or not, live-status and
      title capabilities. A missing or unreadable folder for one tool doesn't affect the other
- [x] Read-only and no new process launch (`read-only.test.ts` unchanged and passing)

Notes:

- Inspected first. Codex documents no interface for reading sessions from outside: rollout
  files, `session_index.jsonl` and SQLite databases are its own internal state. Rollouts were
  profiled across all 75 files on this machine before writing the parser.
- Found by looking at real data:
  - Two record styles. The desktop app records prompts and operations as `item_completed`
    items; the VS Code extension writes `user_message` and `patch_apply_end` events and no
    command records. Only seen by running the bridge against a live VS Code session that
    showed 95 responses and no prompts or tools. Now both are read.
  - Fork and subagent rollouts copy the parent's history, including 72 usage records that
    belong to the parent; usage is kept only where `thread_id` is the session.
  - A compaction's usage can be written before its turn's `turn_context`; it's held until the
    model is known instead of being guessed or dropped.
  - Desktop `exec` tool calls wrap the commands they run, so model tool calls and operations
    are separate event types.
- Real-data check:
  - Parser over all 77 rollouts: 0 unrecognised records; 2,473 responses and 360,443,144
    tokens, an exact match with an independent count from the raw files.
  - Real bridge against an isolated server (port 3200, `adcc_e2e`, throwaway token; no `.env`
    or dev database touched): Claude Code and Codex ingested in the same cycle; 26 Codex
    sessions in `D:\Projects`, 20 with titles, all with details. 24 sessions matched the raw
    usage exactly; the 2 that lagged were a Codex session still being written (and its
    guardian), and the gap closed to the new records on the next cycle. That run was before
    the two-style fix; the parser check above covers it.
- Independent code review fixes:
  - The fixture leaked real file paths and a repo name through object keys and an MCP
    result; the builder now redacts path-shaped keys, and the MCP result is cut down.
  - A rollout outside the approved folders was read up to 16 MB before its folder was
    checked; until a file names its folder, at most 1 MB is read (Claude Code too).
  - A first `session_meta` failing validation let a fork's copied parent meta take over the
    session; only the first one is ever used now.
  - Only `completed` (or no status) counts as an operation completed; other statuses count as
    neither.
  - `mcp_tool_call_end` (the VS Code style's MCP record, first seen during review) is read.
  - Failed turns are shown beside completed and aborted ones.
- Shortcuts:
  - A title change for a caught-up session shows with its next records or a bridge restart.
  - Every Codex rollout is opened once to read its folder (file names don't encode it).
  - `cache_write_input_tokens` is assumed to be part of `input_tokens`; it was always 0.
- Not done:
  - No live status for Codex (no supported interface). Rate-limit data, SQLite state and
    `archived_sessions` aren't read.
  - Bridge-side provider isolation (`listAll` in `main.ts`) has no unit test, because
    `main.ts` starts the loop on import; it's covered by e2e only from the web side.

## Phase 7 — Token and cost analytics

- [ ] Versioned price table (model, input/output/cache rates, effective dates), user-editable
- [ ] Cost computed from real token counts only; unknown shown as unknown
- [ ] Recharts views: usage over time, by project, by model, by source
- [ ] Unit tests for cost maths including price changes over time
- [ ] Validation gate passes

## Phase 8 — Activity timeline

- [ ] Write `ActivityEvent` rows from real sources (task changes, commits/PRs, sessions, action
      runs); the Phase 2 Activity page already reads them
- [ ] Filters by project, source, date range
- [ ] Tests for event merging/ordering
- [ ] Validation gate passes

## Phase 9 — Controlled agent orchestration

- [ ] `Action` model and state machine per ADR-005
- [ ] Approval UI showing exact command, cwd and origin; edit resets approval
- [ ] Bridge polls approved actions, runs in project folder, reports output/exit code
- [ ] Audit log view
- [ ] Unit tests for every state transition, including illegal ones; e2e approve/reject
- [ ] Validation gate passes

## Phase 10 — Windows launcher

- [ ] Web Dockerfile (Next.js standalone output) and `web` compose service on
      `127.0.0.1:3000`, running `prisma migrate deploy` before start (ADR-009)
- [ ] `scripts/start-adcc.ps1`: check Docker Desktop, `docker compose up -d`, wait for
      `/api/health`, start bridge, open browser
- [ ] `scripts/stop-adcc.ps1` (never removes volumes)
- [ ] `scripts/install-shortcut.ps1` creates the desktop shortcut
- [ ] Clear error messages when Docker/Node are missing
- [ ] Validation gate passes; manual launch tested on Windows 11
