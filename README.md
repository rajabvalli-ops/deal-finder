# Deal Finder

UK deal discovery and price-intelligence platform (working name).

- Product scope: [`PRODUCT.md`](PRODUCT.md)
- Technical design and roadmap: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Status

Stage 3 (database). The schema, migrations, seed data and repository layer exist.
Public routes are still placeholders; there is no authentication, admin area or
retailer data yet.

## Requirements

- Node.js 22 (see `.nvmrc`; Next.js 16 needs ≥ 20.9)
- npm

## Getting started

```bash
npm install                 # also generates the Prisma client
cp .env.example .env
docker compose up -d        # PostgreSQL 16 with `dealfinder` and `dealfinder_test` databases
npm run db:migrate          # apply migrations
npm run db:seed             # categories + the development-only mock retailer
npm run dev                 # http://localhost:3000
```

No Docker? Any PostgreSQL 16 works — create the two databases and set the URLs in `.env`.

## Scripts

| Command             | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `npm run dev`       | Start the dev server                                    |
| `npm run build`     | Production build (needs `NEXT_PUBLIC_SITE_URL`)         |
| `npm run start`     | Serve the production build                              |
| `npm run lint`      | ESLint, including architecture module-boundary rules    |
| `npm run typecheck` | TypeScript (strict)                                     |
| `npm run format`    | Format with Prettier (`format:check` to verify only)    |
| `npm test`          | Vitest unit tests                                       |
| `npm run test:e2e`  | Playwright smoke tests (builds and serves on port 3100) |
| `npm run check`     | lint + typecheck + format check + unit tests            |

First-time Playwright setup: `npx playwright install chromium`. To use an already
installed Chromium instead, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## Environment variables

Validated at startup by `src/server/env.ts`; the app refuses to start with invalid
values. See `.env.example` for the full list.

| Name                   | Required      | Purpose                                |
| ---------------------- | ------------- | -------------------------------------- |
| `NEXT_PUBLIC_SITE_URL` | In production | Public base URL for canonical/metadata |

## Module boundaries

`eslint.config.mjs` enforces the layering described in the architecture doc — for
example, UI code cannot import Prisma or retailer adapters, and the pricing and
deal engines cannot import the database or any framework code.
`tests/architecture/boundaries.test.ts` checks these rules keep working.
