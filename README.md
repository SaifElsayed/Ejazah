# Ijazah

A platform for Quran study with certified teachers: find a teacher, book a
package, meet in a live session, and — when the recitation is complete — receive
an ijazah with its sanad.

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm infra:up
pnpm db:migrate && pnpm db:seed
pnpm dev
```

## The map

| Path | What lives there |
|---|---|
| `apps/api` | tRPC over Nest. Two surfaces: mobile and admin. Runs as two processes: `src/main.ts` (requests) and `src/worker.ts` (jobs, idempotent always) |
| `apps/mobile` | Expo Router app. Arabic-first, RTL by default |
| `apps/admin` | Vite SPA back office. Shares contracts, nothing visual |
| `packages/contracts` | The only shared type surface |
| `packages/money` | The branded Piasters type. The platform never holds money: the gateway settles directly to the teacher (ADR 0007) |
| `packages/time` | Slots, zones, DST-safe conversion |
| `packages/config` | Lint boundary rules, tsconfig, prettier |
| `prisma/schema` | Multi-file schema, one file per module |
| `specs` | Spec Kit: spec, then plan, then tasks, then code |
| `docs` | SRS, architecture, ERD, runbook, design |

## Git flow

Task branches are cut from `develop` and named `Ejazah_app/<phase>/<task>`,
for example `Ejazah_app/001-foundations/T001`, so the branch carries the spec
folder and the task id. They open pull requests into `develop`; `develop`
merges into `main` through a release pull request. Nobody pushes to `main` or
`develop` directly (R-PROC-4). Commit subjects are
`Ejazah_app(<phase>): <task id or range> description`, for example
`Ejazah_app(001-foundations): T001 create the pnpm workspace root`.

## Before you write code

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[.specify/memory/constitution.md](.specify/memory/constitution.md). The
boundaries there are enforced by lint, and the reason they exist is in the ADRs.

For anything visual, read [docs/design/design.md](docs/design/design.md) and
[docs/design/components.md](docs/design/components.md) first.
