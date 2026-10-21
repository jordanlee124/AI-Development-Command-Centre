# Roadmap — ADCC

Work proceeds one phase at a time. A phase is done only when every box is ticked and the
validation gate has run. Start a phase only when asked.

**Validation gate (every phase from 1):** `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, and `pnpm test:e2e` where applicable. Record anything that could not run under
the phase's _Notes_.

**Current phase:** Phase 1 complete (with blockers noted) → next is Phase 2.

---

## Phase 0 — Foundation docs ✅

- [x] CLAUDE.md — agent rules and conventions
- [x] ARCHITECTURE.md — components, data flow, security model, ADR-001..006
- [x] ROADMAP.md — phases and checklists
- [x] DEVELOPMENT.md — setup, commands, workflow
- [x] `.gitignore` covering `.env`, build output, dependencies

Notes: no code exists, so lint/typecheck/test/build were not applicable.

## Phase 1 — Application foundation ✅

- [x] pnpm workspace with `apps/web` (bridge and shared package moved to Phase 4)
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

- **Blocker: Docker cannot run on this machine.** Docker Desktop is installed but WSL is not
  (`wsl --install` needs admin rights and a reboot). So `docker compose up`,
  `prisma migrate deploy` against Postgres 17, and a healthy `/api/health` have **not** been
  run. The migration SQL was applied to PGlite (Postgres compiled to WASM): all 9 tables
  created, and Restrict / CHECK / unique constraints each rejected a bad row.
- Dev startup verified: `next dev` boots, renders the shell, and `/api/health` returns 503
  `degraded` (database unreachable); with no `.env` the server refuses to start and names the
  bad variable.
- Another local project (`maplestory-clone`) runs a PGlite server on `127.0.0.1:5432` that
  accepts any password, and its Next dev server holds port 3000. Hence ADR-009's port 55432 and
  e2e's port 3100. While that project runs, `pnpm dev` on 3000 will fail to bind.

## Phase 2 — Projects and tasks

- [ ] Use the existing `Project`, `Milestone`, `Task` models; add fields only via migration
- [ ] CRUD via Server Actions with Zod validation
- [ ] Project list/detail and task board UI
- [ ] Archive instead of delete; task's milestone must be in the same project (service check)
- [ ] Unit tests for validation and status transitions; e2e for create/edit task
- [ ] Validation gate passes

## Phase 3 — GitHub integration (read-only)

- [ ] Fine-grained PAT via `.env`, validated at startup
- [ ] Link project to repo; show branches, open PRs, recent commits, CI status
- [ ] Zod-validated API responses, rate-limit handling, cached in DB
- [ ] Tests with recorded fixtures (no live network in tests)
- [ ] Validation gate passes

## Phase 4 — Agent Bridge + Claude Code sessions

- [ ] Create `packages/shared` (Zod contracts) and `apps/bridge` workspace packages
- [ ] `apps/bridge` host process; config via `.env`; bearer token auth
- [ ] `/api/bridge/ingest` route with shared Zod contract
- [ ] Claude Code JSONL parser: sessions, messages, token usage, model; unknown records counted
- [ ] Idempotent upsert (re-ingest causes no duplicates)
- [ ] Sessions list/detail UI, mapped to projects by working directory
- [ ] Parser tests against real redacted fixtures
- [ ] Validation gate passes

## Phase 5 — Codex sessions

- [ ] Codex JSONL parser into the same normalised format
- [ ] Sessions UI shows both sources with a source filter
- [ ] Parser tests against real redacted fixtures
- [ ] Validation gate passes

## Phase 6 — Token and cost analytics

- [ ] Versioned price table (model, input/output/cache rates, effective dates), user-editable
- [ ] Cost computed from real token counts only; unknown shown as unknown
- [ ] Recharts views: usage over time, by project, by model, by source
- [ ] Unit tests for cost maths including price changes over time
- [ ] Validation gate passes

## Phase 7 — Activity timeline

- [ ] Unified timeline of sessions, commits/PRs, task changes, action runs
- [ ] Filters by project, source, date range
- [ ] Tests for event merging/ordering
- [ ] Validation gate passes

## Phase 8 — Controlled agent orchestration

- [ ] `Action` model and state machine per ADR-005
- [ ] Approval UI showing exact command, cwd and origin; edit resets approval
- [ ] Bridge polls approved actions, runs in project folder, reports output/exit code
- [ ] Audit log view
- [ ] Unit tests for every state transition, including illegal ones; e2e approve/reject
- [ ] Validation gate passes

## Phase 9 — Windows launcher

- [ ] Web Dockerfile (Next.js standalone output) and `web` compose service on
      `127.0.0.1:3000`, running `prisma migrate deploy` before start (ADR-009)
- [ ] `scripts/start-adcc.ps1`: check Docker Desktop, `docker compose up -d`, wait for
      `/api/health`, start bridge, open browser
- [ ] `scripts/stop-adcc.ps1` (never removes volumes)
- [ ] `scripts/install-shortcut.ps1` creates the desktop shortcut
- [ ] Clear error messages when Docker/Node are missing
- [ ] Validation gate passes; manual launch tested on Windows 11
