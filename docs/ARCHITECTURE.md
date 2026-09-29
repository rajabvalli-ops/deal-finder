# Architecture — UK Deal Discovery & Price-Intelligence Platform

Status: **Proposal (Stage 1)**. Nothing in this document is implemented yet.
Scope and product rules: see [`../PRODUCT.md`](../PRODUCT.md).

Contents

1. System architecture
2. Database ERD & relationships
3. Proposed Prisma schema
4. Folder structure
5. API structure
6. Retailer adapter architecture
7. Pricing & deal engine (deterministic calculations)
8. Background-job architecture
9. Authentication & authorisation
10. Affiliate tracking architecture
11. Testing strategy
12. Deployment strategy
13. Implementation roadmap
14. Risks & open decisions

---

## 1. System architecture

A **single Next.js (App Router) application** with strict internal module
boundaries — a "modular monolith". This is the right size for one team on Vercel:
one deploy, one database, no network hops between services. Boundaries are
enforced with ESLint `no-restricted-imports` rules so modules can be extracted
later if ever needed.

```
                         ┌───────────────────────────────────────────────────────────┐
  Browser / crawler ───► │  Next.js on Vercel                                        │
                         │                                                           │
                         │  PRESENTATION                                             │
                         │   app/(public)   Server Components, ISR, minimal JS       │
                         │   app/admin      Server Components + Server Actions       │
                         │   app/go/[code]  outbound redirect (click tracking)       │
                         │   app/api/*      Route Handlers (cron, alerts, health)    │
                         │            │                                              │
                         │            ▼  (only via service interfaces)               │
                         │  APPLICATION SERVICES  src/server/services/*              │
                         │   deals · products · catalogue · alerts · admin · search  │
                         │            │                                              │
                         │   ┌────────┼──────────┬───────────┬──────────┬─────────┐  │
                         │   ▼        ▼          ▼           ▼          ▼         ▼  │
                         │ pricing  deal-     retailers  affiliate  notifica-  analy-│
                         │ engine   engine    (adapters) tracking   tions      tics  │
                         │ (pure)   (pure)       │                    │              │
                         │            │          │                    │              │
                         │            ▼          ▼                    ▼              │
                         │  DATA ACCESS  src/server/db (Prisma client + repositories)│
                         └────────────┬──────────┬────────────────────┬──────────────┘
                                      │          │                    │
                           ┌──────────▼───┐  ┌───▼──────────────┐  ┌──▼────────────┐
                           │ PostgreSQL   │  │ Retailer APIs /  │  │ Email provider│
                           │ (Neon etc.)  │  │ affiliate feeds  │  │ (TBD)         │
                           └──────────────┘  └──────────────────┘  └───────────────┘
      Vercel Cron ──► /api/cron/*  (import · price refresh · detect · expire · alerts)
      Redis (Upstash, optional) ──► rate limiting, locks, cache
```

### Layer rules

| Layer             | Location                    | May depend on                                   | Must NOT depend on                     |
| ----------------- | --------------------------- | ----------------------------------------------- | -------------------------------------- |
| UI (public/admin) | `src/app`, `src/components` | services, `lib`                                 | Prisma, adapters                       |
| Services          | `src/server/services`       | engines, db, adapters, affiliate, notifications | React / Next UI                        |
| Pricing engine    | `src/server/pricing`        | `lib/money` only                                | db, network, clock (time is passed in) |
| Deal engine       | `src/server/deals/engine`   | pricing engine, `lib`                           | db, network, AI                        |
| Retailer adapters | `src/server/retailers`      | `lib`, Zod                                      | db (they return plain data)            |
| Jobs              | `src/server/jobs`           | services                                        | UI                                     |
| Data access       | `src/server/db`             | Prisma                                          | everything above                       |

Key principles:

- **Pure engines.** Pricing and deal logic are pure TypeScript functions that take
  data in and return results — no DB, no `Date.now()`, no randomness. This makes
  them deterministic and exhaustively unit-testable.
- **Money as integers.** All prices stored as integer minor units (pence) with an
  ISO currency code. No floats in money arithmetic. Percentages stored as basis
  points (1% = 100 bps) where persisted.
- **Server-first rendering.** Public pages are React Server Components with
  ISR/tag-based revalidation. Client components only for genuinely interactive bits
  (search filters, alert form, price chart).
- **`server-only` imports.** Everything in `src/server` imports `server-only`, so
  secrets and Prisma can never leak into client bundles.
- **Validate at every boundary** with Zod: env vars, adapter output, form input,
  route params, query strings, cron payloads.

---

## 2. Database ERD & relationships

```
                               ┌────────────┐
                               │  Category  │──┐ parentId (self: tree)
                               └─────┬──────┘◄─┘
                                     │ 1
                                     │ *
  ┌────────────┐ 1            * ┌────┴───────┐ 1           * ┌────────────────┐
  │  Retailer  │───────────────►│  Product   │──────────────►│ ProductVariant │
  └─┬───┬───┬──┘                └─┬───┬───┬──┘               └───────┬────────┘
    │   │   │                     │   │   │ 1                        │ 1
    │   │   │                     │   │   │ *                        │ *
    │   │   │                     │   │ ┌─▼──────────┐ * 1 ┌─────┐  ┌▼─────────────┐
    │   │   │                     │   │ │ ProductTag │────►│ Tag │  │ PriceHistory │
    │   │   │                     │   │ └────────────┘     └──▲──┘  └──────────────┘
    │   │   │ 1                   │ 1 │                        │ 1   (also → Product,
    │   │   │ *                   │ * │                        │ *    → ImportRun)
    │   │   │  (denormalised)   ┌─▼───┴──────┐ 1       * ┌─────┴───┐
    │   │   └──────────────────►│    Deal    │──────────►│ DealTag │
    │   │                       └─┬───┬───┬──┘           └─────────┘
    │   │ 1                       │ 1 │   │ *
    │   │ *                       │ * │   │ reviewedBy 0..1
    │   │   ┌──────────┐ 0..1     │   │   ▼
    │   └──►│  Coupon  │◄─────────┘   │  ┌──────┐ 1        * ┌───────┐ 1     * ┌──────────────┐
    │       └──────────┘              │  │ User │───────────►│ Alert │────────►│ Notification │
    │ 1                               │  └──┬───┘            └───────┘         └──────────────┘
    │ *                               │ *   │ 0..1            filters (all optional):   ▲ *
  ┌─▼─────────────┐ 1          *  ┌───▼───┐ │                 keyword, Product,         │ 1
  │ AffiliateLink │──────────────►│ Click │◄┘                 Category, Retailer    User─┘
  └───────────────┘               └───────┘                                 (+ Deal 0..1)
   (→ Product 0..1, → Deal 0..1)   (→ Deal/Product 0..1, anonymous allowed)

 Supporting tables (not in the original entity list, recommended):
   Account / Session / VerificationToken ──► User      (Auth.js)
   ImportRun ──► Retailer                              (job observability)
   AuditLog  ──► User                                  (admin action trail)
```

### Relationship explanations

- **Retailer 1—\* Product.** A `Product` row is _one retailer's listing_ of an item,
  uniquely identified by `(retailerId, externalId)`. This matches the required
  product fields (retailer, external ID, product URL, current price) and makes
  every adapter import a simple idempotent upsert.
- **Product 1—\* ProductVariant.** Colour/size/storage options under a listing.
  Every product gets at least one variant (a "default" variant) so price history
  always has a consistent anchor. Variants have their own external ID and price.
- **ProductVariant 1—\* PriceHistory.** Append-only price observations
  (price, availability, observed time, source run). Also carries `productId`
  (denormalised) for fast per-product queries. Rows are only written when the
  price/availability changes, plus one daily "heartbeat" row so the engine can
  distinguish "unchanged" from "not observed".
- **Product — denormalised price snapshot.** `Product.currentPrice`,
  `previousPrice`, `lowestPrice`, `highestPrice`, `avg30Price` etc. are a
  _cache_ of the pricing engine's output for the default variant, recomputed on
  each import. The source of truth is always `PriceHistory`.
- **Category 1—\* Product**, with `Category.parentId` forming a tree
  (Electronics › Audio › Headphones).
- **Product 1—\* Deal.** A deal is a _time-bounded editorial event_ about a
  product at a price. It snapshots the prices and computed metrics at detection
  time (so a published deal remains explainable even after prices move) and
  carries a workflow `status`. A product can have many deals over its lifetime,
  but at most one _active_ (pending/approved/published) deal per variant —
  enforced in the service layer and by a partial unique index.
- **Deal → Retailer** is denormalised (`retailerId`) for fast retailer-page queries.
- **Tag \*—\* Product / Deal** through the explicit join tables `ProductTag` and
  `DealTag` (explicit so we can store `source` = manual/rule/ai and timestamps).
- **Coupon → Retailer** (required) and optionally → **Deal**; a coupon can be
  retailer-wide or specific to one deal.
- **AffiliateLink** is the _only_ place outbound retailer URLs are stored for
  redirecting. It belongs to a Retailer and optionally a Product/Deal, and has a
  short opaque `code` used in `/go/[code]`.
- **Click → AffiliateLink** (required), optionally → Deal, Product and User.
  Anonymous clicks are allowed; IPs are stored only as salted hashes.
- **User 1—\* Alert 1—\* Notification.** An alert has optional filters
  (keyword, product, category, retailer) plus `maxPrice`. A Notification is
  one delivery attempt to a user, optionally linked to the alert and deal that
  triggered it — this gives us dedupe ("don't notify twice for the same
  deal/alert") and an audit trail.
- **User → Deal (reviewedBy)** records who approved/rejected a deal.

---

## 3. Proposed Prisma schema

> **Implemented in Stage 3.** [`prisma/schema.prisma`](../prisma/schema.prisma) and
> `prisma/migrations/` are now the source of truth; the listing below is the original
> proposal. Differences made during implementation:
>
> - **Prisma 7:** `prisma-client` generator writing to `src/generated/prisma` (git-ignored,
>   generated on `postinstall`); connection URLs live in `prisma.config.ts`, not the schema;
>   the runtime uses the `@prisma/adapter-pg` driver adapter.
> - `Deal.variantId` is **required** (every product has a default variant), and
>   `Deal.referenceType` is an enum (`ReferencePriceType`). `ImportRun.jobType` is an enum.
> - All timestamps are `timestamptz`; explicit `onDelete` behaviour on every relation.
> - Raw-SQL rules in the initial migration: CHECK constraints (non-negative pence, ISO
>   currency format, rating 0–5, trust score 0–100, `saving = reference − deal price`,
>   discount 0–10 000 bps, score 0–100, alert needs a keyword/product/category, category
>   not its own parent), plus partial unique indexes for **one default variant per
>   product** and **one active deal per variant**.
> - Full-text search indexes are deferred to the search stage.

```prisma
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["fullTextSearchPostgres"]
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")        // pooled
  directUrl = env("DATABASE_URL_UNPOOLED") // migrations
}

// ───────────── Enums ─────────────

enum Role               { USER EDITOR ADMIN }
enum Availability       { IN_STOCK LOW_STOCK OUT_OF_STOCK PREORDER DISCONTINUED UNKNOWN }
enum DealStatus         { DETECTED PENDING_REVIEW APPROVED PUBLISHED REJECTED EXPIRED REMOVED }
enum DealSource         { ENGINE MANUAL }
enum RetailerStatus     { ACTIVE PAUSED DISABLED }
enum IntegrationType    { MOCK AFFILIATE_FEED RETAILER_API MERCHANT_FEED MANUAL }
enum TagSource          { MANUAL RULE AI }
enum NotificationChannel{ EMAIL IN_APP }
enum NotificationStatus { PENDING SENT FAILED SKIPPED }
enum ImportRunStatus    { RUNNING SUCCEEDED PARTIAL FAILED }

// ───────────── Users & auth (Auth.js-compatible) ─────────────

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  emailVerified DateTime?
  name          String?
  image         String?
  role          Role      @default(USER)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts      Account[]
  sessions      Session[]
  alerts        Alert[]
  notifications Notification[]
  clicks        Click[]
  reviewedDeals Deal[]     @relation("DealReviewer")
  auditLogs     AuditLog[]
}

model Account {            // OAuth accounts (Auth.js)
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime
  @@unique([identifier, token])
}

// ───────────── Catalogue ─────────────

model Retailer {
  id              String          @id @default(cuid())
  slug            String          @unique
  name            String
  websiteUrl      String
  logoUrl         String?
  description     String?
  status          RetailerStatus  @default(ACTIVE)
  adapterKey      String          // e.g. "mock", "awin-feed" — selects the adapter
  integrationType IntegrationType
  adapterConfig   Json?           // non-secret config only; secrets live in env
  trustScore      Int             @default(50)   // 0–100, admin-set, used by deal engine
  deliveryInfo    String?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  products        Product[]
  deals           Deal[]
  coupons         Coupon[]
  affiliateLinks  AffiliateLink[]
  alerts          Alert[]
  importRuns      ImportRun[]
}

model Category {
  id          String     @id @default(cuid())
  slug        String     @unique
  name        String
  description String?
  parentId    String?
  parent      Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children    Category[] @relation("CategoryTree")
  sortOrder   Int        @default(0)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  products    Product[]
  alerts      Alert[]
  @@index([parentId])
}

model Product {
  id            String       @id @default(cuid())
  retailerId    String
  externalId    String       // retailer's own ID (SKU/ASIN/etc.)
  slug          String       @unique
  title         String
  brand         String?
  model         String?
  gtin          String?      // EAN/UPC — future cross-retailer matching
  description   String?      @db.Text
  imageUrl      String?
  productUrl    String       // canonical retailer page (never linked directly — see AffiliateLink)
  categoryId    String?
  currency      String       @default("GBP") @db.Char(3)
  availability  Availability @default(UNKNOWN)
  rating        Decimal?     @db.Decimal(3, 2)
  reviewCount   Int?
  isActive      Boolean      @default(true)

  // Denormalised pricing snapshot (cache of pricing engine output; source of truth = PriceHistory)
  currentPrice   Int?        // pence
  previousPrice  Int?
  lowestPrice    Int?
  highestPrice   Int?
  avg7Price      Int?
  avg30Price     Int?
  avg90Price     Int?
  priceUpdatedAt DateTime?

  lastSeenAt    DateTime?    // last time the adapter returned this product
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  retailer       Retailer        @relation(fields: [retailerId], references: [id])
  category       Category?       @relation(fields: [categoryId], references: [id])
  variants       ProductVariant[]
  priceHistory   PriceHistory[]
  deals          Deal[]
  tags           ProductTag[]
  affiliateLinks AffiliateLink[]
  alerts         Alert[]
  clicks         Click[]

  @@unique([retailerId, externalId])
  @@index([categoryId])
  @@index([brand, model])
  @@index([gtin])
}

model ProductVariant {
  id           String       @id @default(cuid())
  productId    String
  externalId   String
  name         String       // "Default", "Black / 256GB"
  attributes   Json?        // { colour: "Black", storage: "256GB" }
  isDefault    Boolean      @default(false)
  currentPrice Int?
  availability Availability @default(UNKNOWN)
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  product      Product        @relation(fields: [productId], references: [id], onDelete: Cascade)
  priceHistory PriceHistory[]
  deals        Deal[]

  @@unique([productId, externalId])
}

model PriceHistory {
  id           String       @id @default(cuid())
  productId    String       // denormalised for fast per-product queries
  variantId    String
  price        Int          // pence
  currency     String       @db.Char(3)
  availability Availability
  observedAt   DateTime
  importRunId  String?

  product      Product        @relation(fields: [productId], references: [id], onDelete: Cascade)
  variant      ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  importRun    ImportRun?     @relation(fields: [importRunId], references: [id])

  @@index([variantId, observedAt])
  @@index([productId, observedAt])
}

// ───────────── Deals ─────────────

model Deal {
  id              String      @id @default(cuid())
  slug            String      @unique
  productId       String
  variantId       String?
  retailerId      String      // denormalised
  status          DealStatus  @default(DETECTED)
  source          DealSource  @default(ENGINE)

  title           String
  summary         String?
  description     String?     @db.Text
  imageUrl        String?
  isFeatured      Boolean     @default(false)

  // Snapshot at detection (explainability — never recomputed silently)
  dealPrice        Int
  referencePrice   Int         // price the saving is measured against
  referenceType    String      // "PREVIOUS" | "AVG_30" | "AVG_90"
  savingAmount     Int
  discountBps      Int         // 2500 = 25.00%
  historicalLow    Int?
  avg30Price       Int?
  avg90Price       Int?
  score            Int         // 0–100 deterministic score
  scoreBreakdown   Json        // per-rule contributions + reasons
  engineVersion    String      // e.g. "deal-engine@1"

  detectedAt      DateTime    @default(now())
  reviewedAt      DateTime?
  reviewedById    String?
  rejectionReason String?
  publishedAt     DateTime?
  expiresAt       DateTime?
  expiredAt       DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  product        Product         @relation(fields: [productId], references: [id])
  variant        ProductVariant? @relation(fields: [variantId], references: [id])
  retailer       Retailer        @relation(fields: [retailerId], references: [id])
  reviewedBy     User?           @relation("DealReviewer", fields: [reviewedById], references: [id])
  tags           DealTag[]
  coupons        Coupon[]
  affiliateLinks AffiliateLink[]
  clicks         Click[]
  notifications  Notification[]

  @@index([status, publishedAt])
  @@index([retailerId, status])
  @@index([productId, status])
  // + raw-SQL partial unique index in migration:
  //   UNIQUE (variantId) WHERE status IN ('DETECTED','PENDING_REVIEW','APPROVED','PUBLISHED')
}

model Coupon {
  id          String    @id @default(cuid())
  retailerId  String
  dealId      String?
  code        String?   // null for "no code needed" offers
  title       String
  description String?
  terms       String?   @db.Text
  validFrom   DateTime?
  validUntil  DateTime?
  isActive    Boolean   @default(true)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  retailer    Retailer  @relation(fields: [retailerId], references: [id])
  deal        Deal?     @relation(fields: [dealId], references: [id])
  @@index([retailerId, isActive])
}

// ───────────── Tags ─────────────

model Tag {
  id        String       @id @default(cuid())
  slug      String       @unique
  name      String
  createdAt DateTime     @default(now())
  products  ProductTag[]
  deals     DealTag[]
}

model ProductTag {
  productId String
  tagId     String
  source    TagSource @default(MANUAL)
  createdAt DateTime  @default(now())
  product   Product   @relation(fields: [productId], references: [id], onDelete: Cascade)
  tag       Tag       @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([productId, tagId])
  @@index([tagId])
}

model DealTag {
  dealId    String
  tagId     String
  source    TagSource @default(MANUAL)
  createdAt DateTime  @default(now())
  deal      Deal      @relation(fields: [dealId], references: [id], onDelete: Cascade)
  tag       Tag       @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([dealId, tagId])
  @@index([tagId])
}

// ───────────── Affiliate & clicks ─────────────

model AffiliateLink {
  id             String   @id @default(cuid())
  code           String   @unique   // short opaque id used in /go/[code]
  retailerId     String
  productId      String?
  dealId         String?
  destinationUrl String   // fully-built outbound URL (validated against retailer allow-list)
  network        String?  // "awin", "cj", "direct", "mock"
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  retailer       Retailer @relation(fields: [retailerId], references: [id])
  product        Product? @relation(fields: [productId], references: [id])
  deal           Deal?    @relation(fields: [dealId], references: [id])
  clicks         Click[]
  @@index([productId])
  @@index([dealId])
}

model Click {
  id              String        @id @default(cuid())
  affiliateLinkId String
  dealId          String?
  productId       String?
  userId          String?
  ipHash          String?       // salted SHA-256, never raw IP
  userAgent       String?
  referrer        String?
  placement       String?       // "deal-page-cta", "listing-card", ...
  isBot           Boolean       @default(false)
  createdAt       DateTime      @default(now())

  affiliateLink   AffiliateLink @relation(fields: [affiliateLinkId], references: [id])
  deal            Deal?         @relation(fields: [dealId], references: [id])
  product         Product?      @relation(fields: [productId], references: [id])
  user            User?         @relation(fields: [userId], references: [id])
  @@index([createdAt])
  @@index([dealId, createdAt])
  @@index([affiliateLinkId, createdAt])
}

// ───────────── Alerts & notifications ─────────────

model Alert {
  id              String    @id @default(cuid())
  userId          String
  keyword         String?
  productId       String?
  categoryId      String?
  retailerId      String?
  maxPrice        Int?      // pence
  minDiscountBps  Int?
  isActive        Boolean   @default(true)
  lastTriggeredAt DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  product       Product?       @relation(fields: [productId], references: [id])
  category      Category?      @relation(fields: [categoryId], references: [id])
  retailer      Retailer?      @relation(fields: [retailerId], references: [id])
  notifications Notification[]
  @@index([isActive])
  @@index([productId])
  // Zod + service rule: at least one of keyword/productId/categoryId required
}

model Notification {
  id        String              @id @default(cuid())
  userId    String
  alertId   String?
  dealId    String?
  channel   NotificationChannel
  status    NotificationStatus  @default(PENDING)
  subject   String
  body      String              @db.Text
  dedupeKey String              @unique  // e.g. `${alertId}:${dealId}` — prevents duplicates
  attempts  Int                 @default(0)
  lastError String?
  sentAt    DateTime?
  readAt    DateTime?
  createdAt DateTime            @default(now())

  user      User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  alert     Alert? @relation(fields: [alertId], references: [id], onDelete: SetNull)
  deal      Deal?  @relation(fields: [dealId], references: [id], onDelete: SetNull)
  @@index([status, createdAt])
}

// ───────────── Operations ─────────────

model ImportRun {
  id           String          @id @default(cuid())
  retailerId   String
  jobType      String          // "catalogue-import" | "price-refresh"
  status       ImportRunStatus @default(RUNNING)
  cursor       String?         // resume point for chunked imports
  itemsSeen    Int             @default(0)
  itemsUpserted Int            @default(0)
  itemsFailed  Int             @default(0)
  errorSample  Json?
  startedAt    DateTime        @default(now())
  finishedAt   DateTime?

  retailer     Retailer        @relation(fields: [retailerId], references: [id])
  priceHistory PriceHistory[]
  @@index([retailerId, startedAt])
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?
  action     String   // "deal.approve", "deal.expire", ...
  entityType String
  entityId   String
  diff       Json?
  createdAt  DateTime @default(now())
  actor      User?    @relation(fields: [actorId], references: [id])
  @@index([entityType, entityId])
}
```

Notes:

- `Product.affiliateUrl` from the spec is deliberately **not** a column on Product:
  it is represented by `AffiliateLink` (see §10), so there is one central place for
  outbound URLs.
- Full-text search: a generated `tsvector` column + GIN index and `pg_trgm` index on
  `Product.title`/`brand`/`model` added via raw SQL migration.
- `PriceHistory` is the only high-volume table. Writing on change + daily heartbeat
  keeps it modest; monthly range partitioning can be added later without app changes.

---

## 4. Folder structure

```
/
├── PRODUCT.md
├── docs/
│   ├── ARCHITECTURE.md
│   └── adr/                         # architecture decision records (one per decision)
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                      # minimal reference data (categories, mock retailer)
├── public/                          # original brand assets only
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                     # /
│   │   │   ├── deals/page.tsx               # /deals
│   │   │   ├── deals/[slug]/page.tsx        # /deals/[slug]
│   │   │   ├── categories/[slug]/page.tsx
│   │   │   ├── retailers/[slug]/page.tsx
│   │   │   ├── search/page.tsx
│   │   │   ├── alerts/page.tsx
│   │   │   └── (legal)/{privacy,terms,affiliate-disclosure}/page.tsx
│   │   ├── admin/
│   │   │   ├── layout.tsx                   # role guard + admin shell
│   │   │   ├── page.tsx                     # overview metrics
│   │   │   ├── deals/{page.tsx,[id]/page.tsx,actions.ts}
│   │   │   ├── products/{page.tsx,[id]/page.tsx}      # incl. price history inspector
│   │   │   ├── retailers/ categories/ users/ alerts/ clicks/ imports/
│   │   ├── go/[code]/route.ts               # outbound redirect + click tracking
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── cron/{import,refresh-prices,detect-deals,expire-deals,process-alerts,send-notifications}/route.ts
│   │   │   ├── alerts/route.ts, alerts/[id]/route.ts
│   │   │   ├── search/route.ts              # (optional JSON API for client filters)
│   │   │   └── health/route.ts
│   │   ├── sitemap.ts
│   │   ├── robots.ts
│   │   ├── layout.tsx
│   │   └── not-found.tsx / error.tsx
│   ├── components/
│   │   ├── ui/                      # design-system primitives (Button, Card, Badge…)
│   │   ├── public/                  # DealCard, PriceBlock, PriceHistoryChart, Breadcrumbs…
│   │   └── admin/                   # DataTable, DealReviewPanel, MetricsCard…
│   ├── server/                      # server-only code (imports 'server-only')
│   │   ├── db/
│   │   │   ├── client.ts            # Prisma singleton
│   │   │   └── repositories/        # product.repo.ts, deal.repo.ts, price-history.repo.ts…
│   │   ├── services/                # use-cases orchestrating engines + repos
│   │   │   ├── catalogue.service.ts
│   │   │   ├── ingestion.service.ts # adapter output → upsert + price history
│   │   │   ├── deal.service.ts      # detection, workflow transitions
│   │   │   ├── search.service.ts
│   │   │   ├── alert.service.ts
│   │   │   └── admin-metrics.service.ts
│   │   ├── pricing/                 # PURE: stats, averages, change %
│   │   │   ├── price-stats.ts
│   │   │   └── price-stats.test.ts
│   │   ├── deals/
│   │   │   ├── engine/              # PURE: rules, scoring, thresholds
│   │   │   │   ├── rules.ts  score.ts  config.ts  engine.test.ts
│   │   │   └── workflow.ts          # allowed status transitions (state machine)
│   │   ├── retailers/
│   │   │   ├── types.ts             # RetailerAdapter interface, NormalisedProduct
│   │   │   ├── schemas.ts           # Zod schemas for adapter output
│   │   │   ├── registry.ts          # adapterKey → factory
│   │   │   ├── contract.test-kit.ts # shared contract tests every adapter must pass
│   │   │   └── adapters/
│   │   │       └── mock/            # MockRetailerAdapter (+ fixtures)
│   │   ├── affiliate/               # link builder, URL allow-list, click recorder
│   │   ├── notifications/           # Notifier interface, email provider, templates
│   │   ├── analytics/               # click aggregation, bot detection
│   │   ├── jobs/                    # job handlers, locking, run bookkeeping
│   │   ├── auth/                    # Auth.js config, requireRole(), session helpers
│   │   ├── rate-limit/              # RateLimiter interface (memory / Upstash)
│   │   └── env.ts                   # Zod-validated environment
│   ├── lib/                         # isomorphic, dependency-free helpers
│   │   ├── money.ts                 # pence ↔ display, bps maths
│   │   ├── slug.ts
│   │   ├── seo.ts                   # metadata + JSON-LD builders
│   │   └── validation/              # shared Zod schemas (search params, alert form)
│   └── proxy.ts                     # (Next 16 "proxy", formerly middleware) admin route gating, security headers
├── tests/
│   ├── e2e/                         # Playwright specs
│   ├── integration/                 # Vitest against a real Postgres
│   └── fixtures/
├── .github/workflows/ci.yml
├── .env.example                     # names only, no values
├── next.config.ts  tailwind/postcss config  tsconfig.json
├── vitest.config.ts  playwright.config.ts
└── package.json
```

Unit tests are colocated (`*.test.ts`); integration and E2E tests live in `tests/`.

---

## 5. API structure

The app favours **Server Components for reads** and **Server Actions for admin
mutations**, so there is little need for a large JSON API. Route Handlers exist
where an HTTP endpoint is genuinely required.

| Endpoint                       | Method         | Auth                 | Purpose                               |
| ------------------------------ | -------------- | -------------------- | ------------------------------------- |
| `/go/[code]`                   | GET            | public, rate-limited | Record click, 302 to retailer         |
| `/api/auth/[...nextauth]`      | *              | —                    | Auth.js                               |
| `/api/alerts`                  | GET / POST     | user                 | List / create alerts                  |
| `/api/alerts/[id]`             | PATCH / DELETE | owner                | Update / delete alert                 |
| `/api/search`                  | GET            | public, rate-limited | JSON search for client-side filter UI |
| `/api/cron/import`             | POST           | `CRON_SECRET`        | Catalogue import per retailer         |
| `/api/cron/refresh-prices`     | POST           | `CRON_SECRET`        | Price refresh                         |
| `/api/cron/detect-deals`       | POST           | `CRON_SECRET`        | Run deal engine                       |
| `/api/cron/expire-deals`       | POST           | `CRON_SECRET`        | Expire stale deals                    |
| `/api/cron/process-alerts`     | POST           | `CRON_SECRET`        | Match alerts → queue notifications    |
| `/api/cron/send-notifications` | POST           | `CRON_SECRET`        | Deliver queued notifications          |
| `/api/health`                  | GET            | public               | Liveness + DB check                   |
| `/api/v1/*`                    | —              | API key              | _Future_ public/partner API           |

Admin Server Actions (`src/app/admin/**/actions.ts`): `approveDeal`, `rejectDeal`,
`updateDeal`, `publishDeal`, `expireDeal`, `removeDeal`, `updateRetailer`, … Each
action: (1) `requireRole('EDITOR'|'ADMIN')`, (2) Zod-parse input, (3) call service,
(4) write `AuditLog`, (5) `revalidateTag()` affected public pages.

Conventions: Zod on all input; typed `Result<T, E>` from services; errors mapped to
HTTP status in one helper; no Prisma types leak to the UI (services return DTOs).

---

## 6. Retailer adapter architecture

**Implemented in Stage 6** (`src/server/retailers/`, `src/server/services/ingestion/`).

### Interface

```ts
interface RetailerAdapter {
  readonly key: string; // "mock", later e.g. "awin-feed"
  readonly allowedHosts: readonly string[]; // product/affiliate URLs must be https on one of these
  readonly capabilities: { catalogue: boolean; priceLookup: boolean };
  fetchCatalogue(req: {
    cursor: string | null;
    limit: number;
  }): Promise<{ items: NormalisedProduct[]; nextCursor: string | null }>;
  fetchPrices(productExternalIds: readonly string[]): Promise<NormalisedPriceUpdate[]>; // unknown IDs omitted
  buildAffiliateUrl(productUrl: string): string;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}
type AdapterFactory = (config: unknown, context: { now: () => Date; env }) => RetailerAdapter;
```

Adapters only fetch and normalise — they never touch the database. The clock is injected so
imports can be replayed (used for backfilling the mock catalogue). `NormalisedProduct`
(`schemas.ts`) is the only shape the rest of the system understands: pence, ISO currency,
availability enum, https URLs, 1–100 variants with exactly one default, optional free-text
`categoryHint`.

### Ingestion flow

```
Retailer row (adapterKey="mock", adapterConfig={productCount: 24})
      │
      ▼
registry.createAdapter(retailer, { now, env }) ──► RetailerAdapter
      │  fetchCatalogue (paged, cursor) / fetchPrices
      ▼
ingestion.service — per item, isolated (one bad item never stops a run):
   1. Zod-validate against normalisedProductSchema           → else counted as failed
   2. productUrl must be https on adapter.allowedHosts       → else counted as failed
   3. categoryHint → slugify → Category by slug (null if no match)
   4. in one transaction: upsert Product + variants by (retailerId, externalId);
      append PriceHistory when price/stock/currency changed or ≥ 24h since the last
      observation (heartbeat); recompute the Product price snapshot with computePriceStats
   5. ImportRun row: counters, cursor, up to 20 error samples,
      status SUCCEEDED / PARTIAL (some failed) / FAILED (all failed or adapter threw)
```

`importCatalogue` stops after `maxPages` and returns `nextCursor` so a later run can resume
(the jobs stage will use this to stay within function time limits). `importPrices` refreshes
known listings; updates for unknown products or variants are counted as failures.

### MockRetailerAdapter

A fictional, deterministic catalogue (`adapters/mock/`): "Mockline" brand, `.invalid` URLs
(RFC 2606), no images, category hints matching the seeded category slugs. Each product's
price follows a fixed schedule from a hash of its ID and the date (a 2–5 day sale of 10–25%
every 20–34 days; out of stock one day in 45), so development data has realistic history
without randomness. `npm run import -- --backfill-days 90` replays the last 90 days into the
dev database.

### Adding a second or third retailer

1. Create `src/server/retailers/adapters/<name>/index.ts` exporting an `AdapterFactory`: parse
   its `adapterConfig` with Zod, read secrets from `context.env`, map the source format to
   `NormalisedProduct`, and declare `allowedHosts`.
2. Register it: one line in `registry.ts` (`"<name>": create<Name>Adapter`).
3. Add its secret names to `env.ts` and `.env.example`.
4. In its test file, call `describeAdapterContract("<name>", …)` with an adapter backed by
   recorded fixtures (no live network in CI). The kit checks pagination terminates without
   duplicates, every item passes the schema, all product and affiliate URLs stay on allowed
   hosts, price lookups match the catalogue and omit unknown IDs, output is deterministic for
   a fixed clock, and the health check passes.
5. Insert a `Retailer` row with `adapterKey="<name>"` (admin UI in a later stage).

Nothing else changes: ingestion, pricing, deals, admin, public pages, affiliate redirects and
alerts all operate on normalised data keyed by `retailerId`. A further merchant on an
already-supported affiliate network needs **no new code** — only another `Retailer` row with a
different `adapterConfig`.

---

## 7. Pricing & deal engine (deterministic)

No AI anywhere in numerical calculations. All functions are pure, integer-based,
and versioned (`engineVersion`) so published results remain reproducible.

### Pricing engine — `computePriceStats(observations, now, config?)`

**Implemented in Stage 4** (`src/server/pricing/`, version `pricing@1`). Pure function; any
change to a calculation must bump the version.

Input: price observations for one variant (any order, one currency), and `now`.
Observations after `now` are ignored. Each observation holds until the next one, capped
at **72 hours** (`maxObservationGapMs`) so a listing that stops updating isn't assumed to
keep its price forever. "Purchasable" means `IN_STOCK`, `LOW_STOCK`, `PREORDER` or
`UNKNOWN` (feeds often omit stock); out-of-stock and discontinued prices are excluded
from everything except `current`.

| Metric                   | Definition                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current`, `isAvailable` | Latest observed price, and whether that observation is purchasable. `currentSince` = start of the current price run                                                                                                             |
| `previous`               | Walking back from the current run: the first purchasable price **different** from `current` that was held ≥ 24h. Short spikes are skipped. `previousUntil` says when it ended, so the deal engine can reject stale "was" prices |
| `lowest` / `highest`     | Min/max purchasable price in the supplied history (the caller chooses the window when querying)                                                                                                                                 |
| `avg7/30/90`             | **Time-weighted** average over the trailing window (each price weighted by how long it applied). `null` unless ≥ 50% of the window is covered by purchasable prices. Exact integer maths, rounded half-up to whole pence        |
| `changeBps`              | `(current − previous) / previous` in basis points, rounded half away from zero                                                                                                                                                  |
| `vsPrevious`             | `compareToReference(current, previous)` → `{ saving, discountBps }`; negative means a price rise                                                                                                                                |

`compareToReference(price, reference)` is also exported for the deal engine, which chooses
the reference (see below). Money helpers (`src/lib/money.ts`) provide `ratioToBps`,
`parsePounds` (string → pence without floats), `formatPrice` and `formatBps`.

Enforcement: ESLint blocks `Date.now()`, argument-less `new Date()`, `Math.random()` and
`performance.now()` in engine code, and CI requires 100% test coverage of the engines and
money helpers.

### Deal engine — `evaluateDeal(input, config?)`

**Implemented in Stage 5** (`src/server/deals/engine/`, version `deal-engine@1`). Pure; input
is the pricing engine's `PriceStats`, `now`, the retailer (`isActive`, `trustScore`) and the
product (`rating`, `reviewCount`, `categorySlug`).

1. **Price present**, else `NO_CURRENT_PRICE`.
2. **Eligibility** (all failures reported together): available to buy; price checked within
   **24h**; first observation ≥ **14 days** old; currency GBP; retailer active.
3. **Reference price** = the **lowest** of: the previous price (only if it ended within
   **60 days**), the 30-day average and the 90-day average. Ties prefer the previous price.
   None available → `NO_REFERENCE_PRICE`; current price not below it → `NO_DISCOUNT`.
   This is what defeats "raise then reduce" pricing: a £100 item raised to £150 for three
   days and "reduced" to £120 is rejected because £120 is above its 30-day average.
4. **Score 0–100**, from integer arithmetic only:

   | Component        | Max | Full points when                                                  |
   | ---------------- | --: | ----------------------------------------------------------------- |
   | `discountDepth`  |  40 | ≥ 50% below the reference (linear)                                |
   | `historicalLow`  |  20 | at or below the lowest recorded price; scales to 0 at 5% above it |
   | `belowAverage90` |  15 | ≥ 30% below the 90-day average (linear)                           |
   | `savingAmount`   |  10 | saving ≥ £100 (tiers: £5 → 2, £10 → 4, £25 → 6, £50 → 8)          |
   | `retailerTrust`  |  10 | trust score 100 (linear)                                          |
   | `socialProof`    |   5 | rating ≥ 4 with ≥ 50 reviews (≥ 10 reviews → 3; 3.5+ → 1)         |
   | **Penalty**      | −15 | previous price > 10% above the 90-day average ("inflated was")    |

5. **Thresholds** (defaults, overridable per category slug): discount ≥ **10%**, saving ≥
   **£5**, score ≥ **35**. A candidate that misses a threshold is still returned with the
   rejection codes, so thresholds can be tuned against real data.

Output: `{ isDeal, candidate, rejections }`. `candidate` maps 1:1 onto the `Deal` snapshot
columns (prices, reference type, saving, discount, score, `scoreBreakdown`, `engineVersion`)
plus human-readable `reasons` for reviewers, e.g. _"19.7% below the 30-day average (£99.67)"_,
_"Lowest price recorded"_. New deals are created as `PENDING_REVIEW` by the jobs stage.

### Deal workflow (state machine)

**Implemented in Stage 5** (`src/server/deals/workflow.ts`). One table defines every
transition, who may make it (`system` = jobs/engine, `editor` = EDITOR/ADMIN) and which
timestamp it sets; anything else is refused with `INVALID_TRANSITION` or `NOT_PERMITTED`.

| Action    | From                                          | To             | Actors         | Sets          |
| --------- | --------------------------------------------- | -------------- | -------------- | ------------- |
| `submit`  | DETECTED                                      | PENDING_REVIEW | system, editor | —             |
| `approve` | PENDING_REVIEW                                | APPROVED       | editor         | `reviewedAt`  |
| `reject`  | DETECTED, PENDING_REVIEW, APPROVED            | REJECTED       | editor         | `reviewedAt`  |
| `publish` | APPROVED                                      | PUBLISHED      | editor         | `publishedAt` |
| `expire`  | DETECTED, PENDING_REVIEW, APPROVED, PUBLISHED | EXPIRED        | system, editor | `expiredAt`   |
| `remove`  | APPROVED, PUBLISHED, EXPIRED                  | REMOVED        | editor         | —             |

Active statuses (DETECTED, PENDING_REVIEW, APPROVED, PUBLISHED) are editable and are the
ones covered by the one-active-deal-per-variant index — an integration test checks the two
lists match. Only PUBLISHED deals appear on the public site.

---

## 8. Background-job architecture

**Implemented in Stage 7** (`src/server/jobs/`, `src/server/services/deals/`,
`src/app/api/cron/[job]/route.ts`, `vercel.json`). Alert and notification jobs come with the
alerts stage.

### Mechanism

- **Trigger:** Vercel Cron calls `GET /api/cron/<job>` with `Authorization: Bearer $CRON_SECRET`.
  The token is compared in constant time (both sides SHA-256 hashed). No secret configured →
  `503`; wrong or missing token → `401` (before revealing whether the job exists); unknown
  job → `404`. Responses are `no-store`; `maxDuration` is 60s.
- **Thin handlers:** the route calls `runScheduledJob(name)`; the same function backs
  `npm run job -- <name>` locally and the integration tests.
- **Mutual exclusion:** a `JobLock` table row per job with a lease (`INSERT … ON CONFLICT …
WHERE lockedUntil <= now`), atomic across instances and safe behind connection poolers
  (session advisory locks are not). A crashed run's lease expires (10–15 min); an overlapping
  run returns `{ status: "skipped" }`.
- **Bounded batches:** catalogue imports process at most 20 pages × 100 items per retailer per
  run and resume from the last `ImportRun.cursor`; price refresh re-prices at most 200
  listings per retailer per run.
- **Isolation:** one retailer's failure (bad adapter key, feed down) is reported and the others
  continue; one product's detection failure is counted and logged.
- **Idempotency:** upserts by `(retailerId, externalId)`; write-on-change price history; the
  one-active-deal-per-variant index (a concurrent duplicate insert counts as "unchanged").

### Jobs

| Job                | Schedule (`vercel.json`, UTC) | What it does                                                                                                                                                                                                         |
| ------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import-catalogue` | daily 04:17                   | Per active retailer: import (or resume) the catalogue. After a **complete** pass, mark listings not seen for 3 days inactive. Then run deal detection on everything just priced.                                     |
| `refresh-prices`   | every 3 h at :07              | Per active retailer with price lookup: re-price listings with active deals first, then the least recently priced. Then run deal detection on them.                                                                   |
| `detect-deals`     | hourly at :37                 | Deal detection for listings priced in the last 26 h (safety net if a chained run was missed).                                                                                                                        |
| `expire-deals`     | hourly at :47                 | Re-check every active deal: expire it if the product was delisted, its `expiresAt` passed, its price hasn't been re-checked for 48 h, it no longer passes the deal engine, or its variant stopped being the default. |

Because detection is chained after imports and refreshes, the pipeline still works on a
hosting plan that only allows daily cron jobs — deals would just be detected and expired
less promptly. **Check your Vercel plan's cron limits before deploying**; some plans reject
schedules that run more than once a day.

### Deal detection (`deal-detection.service.ts`)

For each listing's default variant: load a year of price history → `computePriceStats` →
`evaluateDeal`, then reconcile with the variant's active deal (if any):

| Engine says | No active deal                                           | Active deal exists                                                                                    |
| ----------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| deal        | create as `PENDING_REVIEW` (via the workflow's `submit`) | if the **deal price** changed, refresh its snapshot; otherwise leave the detection-time numbers alone |
| not a deal  | nothing                                                  | expire it (system actor, via the workflow)                                                            |

`expire-deals` uses the same reconciliation but never creates deals and tolerates 48 h (not
24 h) since the last price check. Every create, update and expiry writes an `AuditLog` row
with a null actor and the reason. New deals get the product title and the engine's first
reason as summary; the slug is the title plus a short hash.

---

## 9. Authentication & authorisation

- **Auth.js (NextAuth v5)** with the Prisma adapter, database sessions.
  - Users: email magic link (passwordless; no password storage to secure).
  - Admins: same, plus optional Google/GitHub OAuth; admin accounts restricted
    to an allow-list via `ADMIN_EMAILS` for bootstrap.
- **Roles:** `USER`, `EDITOR` (review/publish deals), `ADMIN` (everything incl.
  retailers, users).
- **Enforcement in depth:**
  1. `proxy.ts` (Next 16's renamed middleware) redirects unauthenticated requests away from `/admin` (fast
     path only — not trusted alone).
  2. `admin/layout.tsx` calls `requireRole()` server-side.
  3. **Every** Server Action / Route Handler calls `requireRole()` / ownership check
     itself (actions are public endpoints).
- Alerts require an account (verified email) — needed for UK GDPR consent and to
  stop alerts being used to spam third parties.
- Other security measures: Zod validation everywhere; Prisma parameterised queries
  (raw SQL only via tagged `Prisma.sql`); CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`
  headers; Server Actions' built-in origin check; secrets only in Vercel env vars,
  validated at boot by `env.ts`; `RateLimiter` interface (in-memory for dev,
  Upstash Redis in prod) on `/go`, auth, alert creation, search; outbound redirect
  URLs checked against the retailer's domain allow-list (no open redirect);
  sanitise any HTML from feeds (render descriptions as text).

---

## 10. Affiliate tracking architecture

```
DealCard / Deal page ──► <OutboundLink code="k3f9a2">  (renders href="/go/k3f9a2", rel="sponsored nofollow")
                                  │
                                  ▼
                      GET /go/[code]  (Route Handler, dynamic, no cache)
                        1. rate-limit by IP hash
                        2. look up AffiliateLink (active) by code
                        3. verify destination host ∈ retailer allow-list
                        4. record Click (async, non-blocking: waitUntil)
                           – linkId, dealId, productId, userId?, ipHash, UA,
                             referrer, placement, isBot (UA heuristics)
                        5. 302 → destinationUrl
```

- **Single source of truth:** `AffiliateLink` rows are created by the ingestion
  service using `adapter.buildAffiliateUrl()`. UI components never see retailer or
  affiliate URLs — only link codes.
- Unknown/inactive code → 404 (no redirect), so the endpoint can't be abused as an
  open redirect.
- Click recording must never block or break the redirect: failures are logged and
  swallowed.
- `/go/*` is disallowed in `robots.txt`; links are `rel="sponsored nofollow noopener"`.
- Every page with outbound links shows a clear affiliate disclosure (ASA/CAP, CMA).
- Privacy: no raw IPs; salted hash with rotating salt; bot clicks flagged and
  excluded from reporting; cookie consent before any non-essential tracking.

---

## 11. Testing strategy

| Level         | Tool                                                              | What                                                                                                                                                                                                                                                  | When                         |
| ------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Unit          | Vitest                                                            | Pricing engine, deal engine, money utils, workflow state machine, Zod schemas, affiliate URL validation. Table-driven tests with hand-computed expected values; edge cases (empty history, single point, gaps, out-of-stock periods, spike-then-drop) | every commit                 |
| Contract      | Vitest                                                            | Shared adapter contract kit run against every adapter with recorded fixtures (no live network in CI)                                                                                                                                                  | every commit                 |
| Integration   | Vitest + real Postgres (Docker locally / service container in CI) | Repositories, ingestion service (idempotent re-imports), deal detection end-to-end on DB, alert matching, notification dedupe, auth guards on actions                                                                                                 | every PR                     |
| E2E           | Playwright                                                        | Critical journeys: browse → deal page → outbound click recorded; search with filters; sign in → create alert; admin approve → deal visible publicly; admin guard blocks non-admins                                                                    | every PR (against seeded DB) |
| Accessibility | Playwright + axe-core                                             | Key public pages have no serious violations                                                                                                                                                                                                           | every PR                     |
| Performance   | Lighthouse CI (later)                                             | Budgets on home + deal page                                                                                                                                                                                                                           | pre-release                  |

Rules: engines aim for ~100% branch coverage; no test hits real retailer APIs; a
real integration is only called "working" after a documented manual/sandbox test.

---

## 12. Deployment strategy

### Environments

| Env        | App                   | Database                                                                                                            | Notes                                                                  |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Local      | `next dev`            | Postgres 16 in Docker (`docker compose`)                                                                            | `.env.local`; Mock adapter only                                        |
| CI         | GitHub Actions        | Postgres service container                                                                                          | lint · typecheck · `prisma validate` · unit · integration · Playwright |
| Preview    | Vercel preview per PR | Neon **branch** per preview (or a shared staging DB)                                                                | Mock adapter; cron disabled                                            |
| Production | Vercel                | Hosted Postgres (recommended: **Neon**, via Vercel Marketplace; Supabase Postgres also fine) — **London/EU region** | Vercel region `lhr1` co-located with DB                                |

### Practices

- **Connections:** pooled URL (`DATABASE_URL`) for serverless runtime; direct URL
  (`DATABASE_URL_UNPOOLED`) for migrations.
- **Migrations:** `prisma migrate deploy` run as an explicit step in the production
  deploy workflow (not on every preview build); migrations are additive/
  backwards-compatible (expand → migrate → contract).
- **Caching:** ISR + `revalidateTag` on deal/product/category/retailer pages; admin
  and `/go` fully dynamic.
- **Secrets:** Vercel environment variables per environment; `.env.example`
  documents names only; `env.ts` fails fast on missing/invalid values.
- **Cron:** `vercel.json` cron entries (production only).
- **Monitoring (later):** Vercel logs + error tracking (e.g. Sentry), uptime check on
  `/api/health`, alert on failed `ImportRun`s.
- **Backups:** provider PITR enabled on production DB.

---

## 13. Implementation roadmap

Each stage ends with passing tests and a summary; no stage starts without instruction.

| #   | Stage                  | Key output                                                                                                                              |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Architecture           | PRODUCT.md, this document ✅                                                                                                            |
| 2   | Project scaffold       | Next.js + TS strict + Tailwind + ESLint/Prettier + Vitest + Playwright + CI + `env.ts`; empty route shells; module-boundary lint rules  |
| 3   | Database               | Prisma schema, first migration, Docker Postgres, minimal seed (categories, one mock retailer row), repository layer + integration tests |
| 4   | Pricing engine         | Pure `computePriceStats` + money utils, exhaustive unit tests                                                                           |
| 5   | Deal engine            | Pure rules/scoring/config + workflow state machine, unit tests                                                                          |
| 6   | Retailer adapters      | Interface, Zod schemas, registry, contract test kit, `MockRetailerAdapter`, ingestion service                                           |
| 7   | Background jobs        | Cron route handlers, job runner, locks, `ImportRun`, deal detection + expiry jobs                                                       |
| 8   | Auth & roles           | Auth.js, roles, guards, proxy, security headers, rate-limiter interface                                                                 |
| 9   | Admin dashboard        | Overview, deal review workflow, products + price-history inspector, retailers, categories, users, audit log                             |
| 10  | Public website         | Home, deals list, deal page (with chart), category & retailer pages, design system, affiliate disclosure                                |
| 11  | Affiliate & clicks     | `AffiliateLink`, `/go/[code]`, click recording, admin clicks view                                                                       |
| 12  | Search                 | Postgres FTS + trigram, filters, sorting, pagination                                                                                    |
| 13  | Alerts & notifications | Alert CRUD, matching job, `Notifier` + email provider, unsubscribe                                                                      |
| 14  | SEO                    | Metadata, canonical, sitemap, robots, OpenGraph, breadcrumbs, JSON-LD                                                                   |
| 15  | Hardening              | Analytics rollups, rate limiting live, a11y/perf budgets, security review                                                               |
| 16  | First real retailer    | One legitimate affiliate feed/API adapter, tested against sandbox/real credentials supplied by you                                      |
| 17  | Automation & AI assist | Auto-approve rules; AI for categorisation, matching, titles/descriptions/tags (never prices)                                            |

---

## 14. Risks & open decisions

1. **Repository — resolved.** The platform lives in its own dedicated repository
   (`deal-finder`), separate from the unrelated `gascert-tracker` project.
2. **Data access is the real bottleneck.** Most UK retailers expose data only via
   affiliate networks (e.g. Awin, CJ, Rakuten, Impact, Partnerize) or programmes like
   Amazon Associates, each requiring approval and with terms on caching, price
   freshness (some require prices be refreshed within ~24h or shown with a
   timestamp) and display. Apply early; design allows it.
3. **Legal/compliance (UK).** Price comparisons and "was" prices must not mislead
   (CMA guidance; Digital Markets, Competition and Consumers Act 2024 unfair
   commercial practices rules). Affiliate relationships must be disclosed (ASA/CAP
   code). Alerts/emails and click tracking fall under UK GDPR and PECR (consent,
   unsubscribe, cookie banner). Show "price checked at <time>" on every price.
4. **Product modelling decision.** Proposed: `Product` = one retailer's listing.
   Cross-retailer comparison ("same TV at 3 shops") needs a later canonical
   `ProductGroup` matched by GTIN/brand+model — deferred, schema leaves room (`gtin`).
5. **Serverless limits.** Large feed imports can exceed Vercel function duration;
   mitigated by chunking/cursors, with Inngest/QStash as the upgrade path.
6. **Auth provider.** Proposed Auth.js (no vendor lock-in, data in our DB). Clerk
   would be faster to ship but adds cost/vendor dependency. Needs your preference.
7. **Email provider** for alerts (Resend, Postmark, SES…) — not chosen; hidden
   behind a `Notifier` interface.
8. **Hosting DB provider & region** — Neon (recommended) vs Supabase vs Vercel
   Postgres; pick a London/EU region for latency and data residency.
9. **Price-history volume** — mitigated by write-on-change; partition later.
10. **Deal-quality tuning** — thresholds need real data to calibrate; keep them in
    config and keep human review until the engine is trusted.
