# Deal Finder

UK deal discovery and price-intelligence platform (working name).

- Product scope: [`PRODUCT.md`](PRODUCT.md)
- Technical design and roadmap: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Status

Stage 11 (affiliate links and click tracking). Built so far: schema and migrations,
repositories, the deterministic pricing and deal engines, the deal workflow, the retailer
adapter framework with `MockRetailerAdapter`, ingestion, deal detection/expiry and scheduled
jobs, email + password sign-in with roles, the admin dashboard, the public site (home,
deals, deal pages with price history, categories, retailers), and outbound links through
`/go/[code]` with click recording. Search and alerts come next. There is no real retailer
yet: mock links point at the fictional `mock-retailer.invalid`, which does not resolve.

## Requirements

- Node.js 22 (see `.nvmrc`; Next.js 16 needs ≥ 20.9)
- npm
- PostgreSQL 16

## Getting started

```bash
npm install                 # also generates the Prisma client
cp .env.example .env
docker compose up -d        # PostgreSQL 16 with `dealfinder` and `dealfinder_test` databases
npm run db:migrate          # apply migrations
npm run db:seed             # categories + the development-only mock retailer
npm run import -- --backfill-days 90   # optional: 90 days of fictional price history
npm run dev                 # http://localhost:3000
```

Create an account at `/sign-up`, then make it an admin (roles can never be chosen at
sign-up):

```bash
npm run user:role -- you@example.com ADMIN
```

No Docker? Any PostgreSQL 16 works — create the two databases and set the URLs in `.env`.

## Scripts

| Command                               | What it does                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run dev`                         | Start the dev server                                                                           |
| `npm run build`                       | Production build (needs `NEXT_PUBLIC_SITE_URL`, `BETTER_AUTH_SECRET`)                          |
| `npm run start`                       | Serve the production build                                                                     |
| `npm run lint`                        | ESLint, including architecture module-boundary rules                                           |
| `npm run typecheck`                   | TypeScript (strict)                                                                            |
| `npm run format`                      | Format with Prettier (`format:check` to verify only)                                           |
| `npm test`                            | Vitest unit tests                                                                              |
| `npm run test:coverage`               | Unit tests with coverage (100% required for engines, workflow, adapters and pure helpers)      |
| `npm run test:integration`            | Integration tests against `TEST_DATABASE_URL` (a real PostgreSQL database)                     |
| `npm run test:e2e`                    | Playwright tests (builds and serves on port 3100 against `DATABASE_URL`)                       |
| `npm run check`                       | lint + typecheck + format check + unit tests                                                   |
| `npm run db:migrate`                  | Create/apply migrations in development                                                         |
| `npm run db:deploy`                   | Apply pending migrations (CI / production)                                                     |
| `npm run db:seed`                     | Seed reference data (idempotent)                                                               |
| `npm run db:studio`                   | Browse the database with Prisma Studio                                                         |
| `npm run import`                      | Run a catalogue import (`--retailer <slug>`, `--backfill-days <n>` for the mock adapter)       |
| `npm run job -- <name>`               | Run a background job now: `import-catalogue`, `refresh-prices`, `detect-deals`, `expire-deals` |
| `npm run user:role -- <email> <role>` | Set an account's role (`USER`, `EDITOR`, `ADMIN`) — the only way to create an admin            |

E2E tests run against `DATABASE_URL` and create uniquely-named test accounts, retailers
and products there (prefixed "E2E"/"e2e-"). CI uses a throwaway database; locally, point
`DATABASE_URL` at a database you don't mind accumulating test records in.

First-time Playwright setup: `npx playwright install chromium`. To use an already
installed Chromium instead, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## Environment variables

Validated at startup by `src/server/env.ts`; the app refuses to start with invalid
values. See `.env.example` for the full list.

| Name                    | Required           | Purpose                                                            |
| ----------------------- | ------------------ | ------------------------------------------------------------------ |
| `DATABASE_URL`          | Always             | PostgreSQL connection (pooled in production)                       |
| `DATABASE_URL_UNPOOLED` | No                 | Direct connection for migrations; falls back to `DATABASE_URL`     |
| `NEXT_PUBLIC_SITE_URL`  | In production      | Public base URL for canonical URLs, metadata and auth              |
| `BETTER_AUTH_SECRET`    | In production      | Signs session cookies (≥ 32 characters)                            |
| `CRON_SECRET`           | For scheduled jobs | Bearer token for `/api/cron/*` (≥ 32 characters); unset = cron off |
| `TEST_DATABASE_URL`     | Integration tests  | Database name must contain "test" — every table is truncated       |

## Database

- Schema: `prisma/schema.prisma`; migrations: `prisma/migrations/`. Money is integer
  pence, percentages are basis points, timestamps are `timestamptz`.
- Integrity rules Prisma can't express (CHECK constraints, partial unique indexes) are in
  the migration SQL and covered by `tests/integration/constraints.test.ts`.
- Only `src/server/db` may import the generated Prisma client; everything else goes through
  repositories and services (enforced by ESLint).
- The seed creates reference categories and, outside production, a clearly fake
  `mock-retailer` (`.invalid` domain). It never creates products or prices.

## Outbound links

Retailer URLs are stored only in `AffiliateLink` rows. Each catalogue import builds them with
the retailer's adapter. Pages link to `/go/<code>`, which records the click and redirects.
To give already-imported products their links, run `npm run import` (or wait for the daily
catalogue job). Clicks are listed under `/admin/clicks`. IP addresses are stored only as a
daily-rotating keyed hash. Details: `docs/ARCHITECTURE.md` §10.

## Background jobs

Vercel Cron calls `GET /api/cron/<job>` with `Authorization: Bearer $CRON_SECRET` on the
schedules in `vercel.json`. Check your hosting plan's cron limits before deploying — some
plans only allow daily jobs (the pipeline still works, less promptly). Details:
`docs/ARCHITECTURE.md` §8.

## Module boundaries

`eslint.config.mjs` enforces the layering described in the architecture doc — for
example, UI code cannot import Prisma or retailer adapters, and the pricing and
deal engines cannot import the database or any framework code or read the clock.
`tests/architecture/boundaries.test.ts` checks these rules keep working.
