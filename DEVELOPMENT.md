# Development — ADCC

How to set up, run and validate the project. Commands are PowerShell on Windows 11, run from
the repo root unless noted.

## Prerequisites

| Tool           | Version                              | Why                                |
| -------------- | ------------------------------------ | ---------------------------------- |
| Windows 11     | —                                    | only supported OS                  |
| WSL 2          | `wsl --install` (admin, then reboot) | required by Docker Desktop         |
| Docker Desktop | current, WSL2 backend                | runs PostgreSQL                    |
| Node.js        | 22.12+ or 24 LTS                     | Next.js, tooling, bridge (Phase 4) |
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
| `pnpm build`       | production build                                                     |
| `pnpm lint`        | Prettier check + ESLint (zero warnings allowed)                      |
| `pnpm format`      | Prettier write                                                       |
| `pnpm typecheck`   | Next route typegen + `tsc --noEmit`                                  |
| `pnpm test`        | Vitest unit tests                                                    |
| `pnpm test:e2e`    | Playwright; starts its own dev server on port 3100, never reuses one |
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

| Variable            | Used by          | Notes                                        |
| ------------------- | ---------------- | -------------------------------------------- |
| `POSTGRES_USER`     | db container     | default `adcc`                               |
| `POSTGRES_PASSWORD` | db container     | URL-safe (letters and digits); not committed |
| `POSTGRES_DB`       | db container     | default `adcc`                               |
| `DATABASE_URL`      | web, Prisma CLI  | `postgresql://…@127.0.0.1:55432/adcc`        |
| `GITHUB_TOKEN`      | web (Phase 3)    | fine-grained PAT, read-only                  |
| `ADCC_BRIDGE_TOKEN` | web, bridge (P4) | 32 random bytes, base64 (see below)          |
| `ADCC_WEB_URL`      | bridge (Phase 4) | default `http://127.0.0.1:3000`              |

Generate random secrets with a cryptographic RNG:

```powershell
$b = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

## Ports

| Port  | What                        | Note                               |
| ----- | --------------------------- | ---------------------------------- |
| 3000  | `pnpm dev` / `pnpm start`   | loopback only                      |
| 3100  | Playwright's own dev server | e2e never reuses a running server  |
| 55432 | Postgres (host side)        | deliberately not 5432; see ADR-009 |

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
- **E2E (Playwright):** under `apps/web/e2e/`. Must pass whether or not Postgres is running
  until a phase needs data; assert on the real response, never on invented data.
- **Fixtures:** real data must be redacted (paths, usernames, prompts with secrets) before
  committing. Fixtures never leak into the running app.
- **No live network** in tests — use recorded GitHub responses.

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
- **Server exits with "Invalid environment configuration":** fix the named variable in
  `apps/web/.env`.
