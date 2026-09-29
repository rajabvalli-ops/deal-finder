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

> Proposal only — not created yet. Will be refined in the database stage.

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

### Interface (sketch — not implemented)

```ts
interface RetailerAdapter {
  readonly key: string; // "mock", "awin-feed", …
  readonly capabilities: {
    catalogue: boolean; // can list/paginate products
    priceLookup: boolean; // can fetch prices for known IDs
    deepLinks: boolean; // can build affiliate deep links
  };
  fetchCatalogue(opts: {
    cursor?: string;
    limit: number;
  }): Promise<{ items: NormalisedProduct[]; nextCursor?: string }>;
  fetchPrices(externalIds: string[]): Promise<NormalisedPrice[]>;
  buildAffiliateUrl(productUrl: string, ctx: { placement?: string }): string;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}
```

`NormalisedProduct` / `NormalisedPrice` are the _only_ shape the rest of the
system understands: prices in pence, ISO currency, `Availability` enum, variants
array, category hint string, image URL, rating, etc. Each adapter's output is
validated with the shared Zod schema before ingestion — invalid items are
counted as failures on the `ImportRun`, never written.

### Flow

```
Retailer row (adapterKey="mock", adapterConfig={…})
      │
      ▼
registry.get(adapterKey)(config, secretsFromEnv) ──► RetailerAdapter instance
      │  fetchCatalogue / fetchPrices
      ▼
NormalisedProduct[]  ──Zod──►  ingestion.service
      │                          • upsert Product by (retailerId, externalId)
      │                          • upsert variants
      │                          • append PriceHistory when changed / heartbeat
      │                          • map category hint → Category (mapping table/rules)
      │                          • ensure AffiliateLink via adapter.buildAffiliateUrl
      ▼                          • recompute Product price snapshot (pricing engine)
deal detection (next job)
```

### Adding a second or third retailer

1. Create `src/server/retailers/adapters/<name>/index.ts` implementing `RetailerAdapter`
   (plus a feed/API client and a mapper from the source format to `NormalisedProduct`).
2. Register it in `registry.ts`: `"<name>": (cfg, env) => new NameAdapter(cfg, env)`.
3. Add its secret names to `env.ts` (Zod) and `.env.example`.
4. Run the shared **adapter contract test kit** against it with recorded fixtures.
5. Insert a `Retailer` row (via admin UI) with `adapterKey="<name>"`.

Nothing else changes: ingestion, pricing, deals, admin, public pages, affiliate
redirects and alerts all operate on normalised data keyed by `retailerId`. Jobs
iterate over `Retailer` rows with `status=ACTIVE`, so a new retailer is picked up
automatically. A third retailer on the _same_ affiliate network (e.g. two
merchants on one feed network) usually needs **no new code** — only a new
`Retailer` row with a different `adapterConfig` (merchant ID).

---

## 7. Pricing & deal engine (deterministic)

No AI anywhere in numerical calculations. All functions are pure, integer-based,
and versioned (`engineVersion`) so published results remain reproducible.

### Pricing engine — `computePriceStats(history, now)`

Input: price observations for one variant (sorted), and `now`.

| Metric               | Definition                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current`            | Latest observed price while in stock                                                                                                                                                        |
| `previous`           | The most recent _different_ price that was held for ≥ N hours (default 24h) — ignores momentary blips                                                                                       |
| `lowest` / `highest` | Min/max over full history (configurable window, e.g. 365d)                                                                                                                                  |
| `avg7/30/90`         | **Time-weighted** average over the window: each price weighted by how long it was in effect (irregular sampling would otherwise bias a simple mean). `null` if coverage < 50% of the window |
| `changePct`          | `(current − previous) / previous`, in bps                                                                                                                                                   |
| `saving`             | `reference − current` (pence), where reference is chosen below                                                                                                                              |
| `discountPct`        | `saving / reference`, in bps, rounded half-up                                                                                                                                               |

### Deal engine — `evaluateDeal(stats, context, config)`

1. **Eligibility gates** (all must pass, else no deal):
   in stock; price observed within the last X hours; min history length (e.g. ≥ 14
   days of coverage) so we don't trust a new listing's "was" price; retailer ACTIVE;
   currency GBP.
2. **Reference price** = the _most conservative_ credible comparison:
   `min(previous, avg30, avg90)` among available values. This prevents inflated
   "was" prices from generating fake discounts.
3. **Thresholds**: `discountPct ≥ minDiscount` (e.g. 10%) AND `saving ≥ minSaving`
   (e.g. £5), both configurable per category.
4. **Signals → score 0–100** (weighted, each capped):
   - depth of discount vs reference
   - discount vs 90-day average
   - proximity to historical low (at or below low = max points)
   - absolute saving (log-scaled so £500 TVs don't dominate)
   - retailer trust score
   - social proof (rating/review count) — small weight
   - penalty: price was raised shortly before the drop ("spike then drop" pattern)
5. **Output**: `{ isDeal, score, referencePrice, referenceType, saving, discountBps,
reasons: [...], breakdown: {...} }`. Reasons are human-readable strings shown
   to admins ("22% below 90-day average", "Lowest price in 180 days").
6. **Status**: new deals start as `PENDING_REVIEW`. Later, automation can
   auto-approve above a configured score for trusted retailers.

### Deal workflow (state machine)

```
DETECTED → PENDING_REVIEW → APPROVED → PUBLISHED → EXPIRED
                  │             │           │
                  └→ REJECTED   └→ REJECTED └→ REMOVED
```

Transitions are defined in one table in `workflow.ts`; any other transition is refused.

---

## 8. Background-job architecture

### Mechanism

- **Scheduler:** Vercel Cron hits `/api/cron/*` route handlers, authenticated with
  `Authorization: Bearer ${CRON_SECRET}`.
- **Handlers are thin:** they call a job function in `src/server/jobs/` which calls
  services. The same job functions can be run from a CLI script (`npm run job:x`)
  locally and in tests.
- **Chunking & resumability:** each run processes a bounded batch within the function
  time limit and stores its `cursor` on `ImportRun`; the next invocation resumes.
- **Idempotency:** upserts keyed by `(retailerId, externalId)`; notifications keyed
  by `dedupeKey`; deal creation guarded by partial unique index.
- **Concurrency:** Postgres advisory lock per `(job, retailerId)` so overlapping
  cron invocations can't double-process.
- **Observability:** `ImportRun` rows + structured logs; admin "Imports" page shows
  run history and error samples.
- **Scale path:** if volumes outgrow cron + chunking, swap the trigger layer for a
  durable queue (Inngest or Upstash QStash) **without changing job functions**.

### Pipeline

| Job                   | Schedule (initial)                                | What it does                                                                                                                                                                            |
| --------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue import      | daily per retailer                                | `adapter.fetchCatalogue` pages → ingestion (upsert products/variants, category mapping, affiliate links, price observation). Marks products not seen for N days inactive                |
| Price refresh         | every 1–6h (per retailer config / API quota)      | `adapter.fetchPrices` for active products, prioritising products with active deals, alerts or high traffic → PriceHistory on change → recompute snapshot                                |
| Deal detection        | after each price refresh (chained) + hourly sweep | For variants whose price changed: pricing engine → deal engine → create `PENDING_REVIEW` deal or update an existing active one                                                          |
| Deal expiry           | every 15–30 min                                   | Expire published deals when price rises above deal price by > tolerance, item goes out of stock, `expiresAt` passes, or price not re-verified within X hours. Revalidate affected pages |
| Alert matching        | after deal detection / price refresh              | For changed products, find active alerts where filters match and `current ≤ maxPrice` → create `Notification(PENDING)` with dedupe key                                                  |
| Notification delivery | every 5 min                                       | Send PENDING notifications through `Notifier` with retries/backoff; mark SENT/FAILED                                                                                                    |
| Analytics rollup      | nightly                                           | Aggregate clicks per deal/retailer/day; flag bot traffic                                                                                                                                |

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
