# CLAUDE.md — AI Development Command Center (ADCC)

Instructions for AI agents (Claude Code, Codex) and humans working in this repo.
Read this first, then [ARCHITECTURE.md](ARCHITECTURE.md) for design, [ROADMAP.md](ROADMAP.md)
for the current phase, and [DEVELOPMENT.md](DEVELOPMENT.md) for commands.

## What this is

A Windows 11, localhost-only dashboard for managing AI-assisted development: projects and
tasks, GitHub repos, Claude Code and Codex session monitoring, token/cost analytics, an
activity timeline, and human-approved agent orchestration. It is never hosted, never exposed
to a network, and never reachable from the internet.

## Hard rules

These are not style preferences. Breaking one is a bug.

1. **Inspect before changing.** Read the code and docs you are about to touch, and their
   callers, before editing.
2. **Complete only the requested phase.** Check [ROADMAP.md](ROADMAP.md). Do not start the
   next phase's work, and do not add features no phase asks for.
3. **Never invent data.** Agent sessions, token counts, costs and activity come only from real
   sources (session files, GitHub API, user input). No placeholder, demo or estimated values in
   the app or the database. Missing data is shown as missing, not guessed. Test fixtures live
   only under test directories and are clearly fixtures.
4. **Never execute unapproved commands.** Any command proposed by an AI agent is stored as a
   proposal and runs only after explicit user approval in the UI. See ADR-005.
5. **Never delete user data without approval.** No destructive migrations,
   `prisma migrate reset`, `docker compose down -v`, or file deletion outside build output
   without the user saying yes for that specific action.
6. **Credentials stay out of git.** Secrets live in `.env` (gitignored). Commit only
   `.env.example` with empty values. Never log tokens or print them in errors.
7. **Localhost only.** Every listening port binds to `127.0.0.1`. Never `0.0.0.0`, never a
   tunnel, never Tailscale, never a cloud deploy.
8. **Validate every external input with Zod** at the boundary: HTTP request bodies, query
   params, env vars, session files, GitHub responses, bridge messages.
9. **Strict TypeScript.** No `any`, no `@ts-ignore`/`@ts-expect-error` without a one-line
   reason, no disabling `strict` flags.
10. **No unnecessary refactoring.** Change what the task needs. Note other problems; don't fix
    them uninvited.

## Conventions

- **Package manager:** pnpm only. Never commit `package-lock.json` or `yarn.lock`.
- **Layout:** pnpm workspace. Today only `apps/web` (Next.js). `apps/bridge` and
  `packages/shared` arrive in Phase 4. Details in ARCHITECTURE.md.
- **Naming:** files `kebab-case.ts`, React components `PascalCase`, functions/vars
  `camelCase`, Prisma models `PascalCase` singular, DB tables mapped to `snake_case`.
- **Imports:** use the `@/` alias inside `apps/web`; import shared code as `@adcc/shared`.
- **Server first:** React Server Components by default; `"use client"` only where
  interactivity needs it. Mutations go through Server Actions or route handlers that validate
  with Zod.
- **Layers (ADR-007, enforced by ESLint):** `src/domain` is pure (no I/O, React, Next or
  Prisma). `src/server/db` is the only code that touches Prisma. `src/server/services` holds
  use cases. `src/app` and `src/components` call services, never `src/server/db`.
- **Database:** schema changes only via `pnpm db:migrate` with a committed migration. Never
  `prisma db push`. Never edit `src/generated/` (rebuilt by `prisma generate`). CHECK
  constraints are hand-written into migration SQL (Prisma can't express them).
- **UI:** shadcn/ui components and Tailwind tokens. Don't hand-roll a widget shadcn already has.
- **Errors:** fail loudly at boundaries with a typed error; never swallow an error that could
  hide lost or wrong data.
- **Comments:** explain why, not what. Known shortcuts get `// shortcut: <limit>, <when to upgrade>`.
- **Tests:** Vitest for business logic (parsers, cost maths, approval state machine,
  validation). Playwright for critical user flows. Every bug fix gets a test that would have
  caught it.
- **Commits:** small, one logical change, imperative subject (`Add session parser for Codex`).
  Conventional prefixes optional. Don't commit unless asked.

## Definition of done (every phase)

Run all of these and report results. If any cannot run, say which and why — never claim a
pass you did not see.

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Then tick the phase checklist in ROADMAP.md, and record any new architectural decision as an
ADR in ARCHITECTURE.md.

## When unsure

Ask. Especially before: deleting anything, changing the DB schema destructively, adding a
dependency, opening a port, or running any command an AI proposed.
