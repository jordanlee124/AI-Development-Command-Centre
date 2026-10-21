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

Target state. Until Phase 9 the web app runs on the host via `pnpm dev`, and only Postgres is
in Docker (ADR-009). The bridge arrives in Phase 4.

## Components

### `apps/web` — Next.js dashboard

- Next.js App Router, React, TypeScript strict, Tailwind, shadcn/ui, Recharts.
- Owns the database (Prisma 7 with the `pg` driver adapter) and all business logic.
- Exposes a small, token-authenticated **bridge API** under `/api/bridge/*` that only the
  Agent Bridge calls (Phase 4).
- Calls GitHub's REST API outbound with a user-supplied token (Phase 3).
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
    app/              routes, layouts, route handlers: thin, call services
    components/       UI; components/ui = shadcn, app-shell = layout chrome
    lib/              UI helpers (cn)
    generated/prisma/ generated client (gitignored, rebuilt on install)
  prisma/             schema.prisma, migrations/
  e2e/                Playwright tests
```

Unit tests sit next to the code as `*.test.ts`.

## Data model

Defined in `apps/web/prisma/schema.prisma` (ADR-008).

| Model                | Purpose                                      | Key constraints                                           |
| -------------------- | -------------------------------------------- | --------------------------------------------------------- |
| `Project`            | a piece of work; optional local folder       | unique `slug`, unique `localPath`; archive, don't delete  |
| `Repository`         | GitHub repo, optionally linked to a project  | unique `(owner, name)`, unique `githubId`                 |
| `Milestone`          | dated goal inside a project                  | unique `(projectId, title)`                               |
| `Task`               | unit of work in a project, maybe a milestone | indexed `(projectId, status)`                             |
| `AgentSession`       | one Claude Code / Codex session file         | unique `(source, externalId)`; skipped-record count ≥ 0   |
| `AgentEvent`         | one record from a session file               | unique `(sessionId, externalId)` → idempotent re-ingest   |
| `UsageRecord`        | token counts for one event                   | one per event; all token counts ≥ 0 (CHECK); no cost col. |
| `ActivityEvent`      | timeline entry from a real event             | unique `dedupeKey`; optional links to project/repo/task   |
| `ApplicationSetting` | key → JSON value                             | value validated by a domain Zod schema before writing     |

Delete behaviour: deleting a project or milestone that still has tasks/milestones is
**blocked** by the database (Restrict). Optional links (repo→project, session→project, task→
milestone, activity→anything) become null. Events and usage are deleted only with their
session.

### `packages/shared` — contracts (Phase 4)

- Zod schemas and inferred types shared by web and bridge: bridge API payloads, normalised
  session/usage records, action proposals.
- No runtime dependencies besides Zod. No I/O.

### `apps/bridge` — Agent Bridge (Windows host, Node + TypeScript, Phase 4)

- Runs on the host, not in Docker, because it needs the Windows filesystem, local git repos,
  and PowerShell.
- **Ingestion:** watches Claude Code (`%USERPROFILE%\.claude\projects\**\*.jsonl`) and Codex
  (`%USERPROFILE%\.codex\sessions\**\*.jsonl`) session files, parses them into the shared
  normalised format, and POSTs them to the web bridge API.
- **Execution:** polls the web app for _approved_ actions, runs them under the rules in
  ADR-005, and reports output and exit codes back.
- **Has no listening port.** It is a client only (ADR-003).

### PostgreSQL (Docker)

- Single database, named Docker volume for persistence.
- Schema changes only through Prisma migrations.

## Data flow

1. **Sessions/usage:** session file → bridge parser (Zod-validated, tolerant of unknown
   records) → `POST /api/bridge/ingest` → upsert keyed by source + session id + record id, so
   re-ingesting the same file is idempotent.
2. **Costs:** computed in the web app from stored token counts × a versioned price table
   (per model, with effective dates). Records without token counts have no cost — never an
   estimate.
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
- **Browser-side CSRF/DNS-rebinding:** mutating routes check the `Host` and `Origin` headers
  are `127.0.0.1:3000` / `localhost:3000`.
- **Secrets:** `apps/web/.env` only, validated by a Zod env schema at startup; the app
  refuses to start on invalid config, and validation errors name the bad key, never its value. GitHub token is a fine-grained PAT, read-only scopes
  until a phase needs more.
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

- **Status:** Accepted (Phase 0). Web container deferred to Phase 9 by ADR-009.
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

- **Status:** Accepted (Phase 1)
- **Context:** The database holds the user's only copy of tasks and ingested history.
- **Decision:**
  - UUIDv7 primary keys (`@db.Uuid`, time-ordered), `timestamptz(3)` for every timestamp,
    snake_case table names.
  - Foreign keys from user-authored children (tasks, milestones) to projects are `Restrict`.
    Projects are archived (`archivedAt`), not deleted.
  - Idempotency lives in unique constraints (`(source, externalId)`,
    `(sessionId, externalId)`, `dedupeKey`), so ingestion can retry safely.
  - Invariants Prisma can't express are hand-written CHECK constraints in migration SQL.
  - Cost is never stored; it's derived from token counts and a price table (Phase 6).
  - Event/type names coming from external tools are `varchar`, not enums, so a new agent
    record type never breaks ingestion.
  - Task-milestone same-project rule is enforced in the task service (Phase 2), not by FK.
- **Consequences:** Accidental deletes fail loudly. `prisma migrate dev` won't detect drift in
  CHECK constraints, so they must be kept in migrations by hand.

### ADR-009: Web runs on the host until Phase 9; Postgres on port 55432

- **Status:** Accepted (Phase 1)
- **Context:** Docker could not run on the dev machine when Phase 1 was built (WSL not
  installed), so a web container could not be tested. During Phase 1 another local project
  was found listening on `127.0.0.1:5432` and accepting any password, so ADCC silently
  connected to the wrong database.
- **Decision:** Phase 1 runs only Postgres in compose. The web container (Dockerfile, compose
  service) moves to Phase 9 with the launcher, where it can be tested end to end. Postgres is
  published on host port `55432`, so a clash fails loudly at `docker compose up` instead of
  connecting elsewhere. One env file, `apps/web/.env`, is read by Next.js, the Prisma CLI and
  compose (`env_file`).
- **Consequences:** Until Phase 9 the developer starts the web app with `pnpm dev`. Containers
  reach Postgres on 5432 internally; the host uses 55432.
