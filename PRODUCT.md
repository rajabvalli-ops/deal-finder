# PRODUCT.md — UK Deal Discovery & Price-Intelligence Platform

> Source of truth for product scope. Check this file before starting every stage.
> Detailed technical design lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Purpose

A production-quality UK deal aggregation and price-tracking website. It must have
**completely original** branding, UI, UX, code and content — nothing copied from any
existing deal site.

The platform will:

1. Discover products from legitimate retailer APIs, affiliate feeds, merchant feeds or other permitted sources.
2. Track product prices over time.
3. Detect meaningful discounts using historical pricing.
4. Let an administrator review and approve deals.
5. Publish approved deals to a fast public website.
6. Let users search for products and deals.
7. Let users create price alerts.
8. Track outbound affiliate clicks.
9. Eventually automate deal discovery and publishing.

## Tech stack

Next.js (App Router) · TypeScript · Tailwind CSS · PostgreSQL · Prisma · Zod · Vitest · Playwright.
Deployed on Vercel with hosted PostgreSQL.

## Separated concerns

Public website · admin dashboard · database layer · business logic · pricing engine ·
deal engine · retailer integrations · background jobs · affiliate tracking ·
notifications · analytics.

## Retailer integrations

- Never hard-code the application around a single retailer.
- Each retailer is a `RetailerAdapter` implementation; start with `MockRetailerAdapter`.
- Never invent real API credentials.
- No scraping unless the retailer's terms and permitted access allow it.

## Data model (entities)

User, Retailer, Category, Product, ProductVariant, PriceHistory, Deal, Coupon, Alert,
Notification, Click, AffiliateLink, Tag, DealTag, ProductTag.

**Product fields:** title, brand, model, description, image, category, retailer,
external retailer ID, product URL, affiliate URL, current price, previous price,
currency, availability, rating, review count, timestamps.

## Price intelligence

Track historical prices and calculate: current price, previous price, lowest and
highest recorded price, 7/30/90-day averages, percentage change, savings,
discount percentage.

## Deal engine

- Deterministic calculations using: current price, previous price, historical
  averages, historical low, discount %, saving amount, availability, retailer info.
- **AI must never determine numerical pricing.** AI may later assist with
  categorisation, product matching, deal titles, descriptions, tags and summaries.

## Admin dashboard

Sections: overview metrics, deals, products, retailers, categories, price history,
users, alerts, clicks.
Actions: approve, reject, edit, publish, expire and remove deals; inspect price history.

## Public website

Routes: `/`, `/deals`, `/deals/[slug]`, `/categories/[slug]`, `/retailers/[slug]`,
`/search`, `/alerts`.

- **Homepage (eventually):** search, popular categories, featured deals, latest deals,
  deals near historical lows, popular retailers.
- **Deal page (eventually):** image, title, retailer, current/previous price, discount,
  savings, price history, 7/30/90-day averages, historical low, availability,
  product info, related deals, clear affiliate disclosure.
- **Search (eventually):** keyword, category, retailer, price range, discount,
  availability, sorting, pagination.
- **Alerts (eventually):** e.g. "Tell me when Sony WH-1000XM5 is below £100" —
  by keyword, product, maximum price, category, retailer.

## Affiliate tracking

- No affiliate URLs scattered through the app — one central affiliate-link system.
- Outbound clicks are tracked before redirecting to the retailer.

## SEO (eventually)

Dynamic metadata, canonical URLs, sitemap, robots.txt, OpenGraph, breadcrumbs,
structured data, clean SEO-friendly URLs.

## Non-functional

- **Performance:** mobile-first, fast, accessible, responsive, efficient DB queries,
  minimal client-side JavaScript.
- **Security:** authentication, authorisation, validation, secure env vars,
  rate-limiting architecture, safe DB queries, protection against common web
  vulnerabilities.

## Development rules

- Work in controlled stages; never build everything at once.
- Before each stage: understand existing code → check PRODUCT.md → explain the change →
  implement only that stage → run tests → fix errors → check regressions → summarise.
- No fake production functionality. Mock data only where explicitly requested.
- Never claim an integration works unless it has actually been tested.
- No unrelated changes. Don't delete working functionality to make a task easier.
- Keep code modular and maintainable.

## Stage status

| Stage | Description                               | Status      |
| ----- | ----------------------------------------- | ----------- |
| 1     | Architecture & PRODUCT.md                 | ✅ Done     |
| 2     | Project scaffold                          | ✅ Done     |
| 3     | Database                                  | ✅ Done     |
| 4     | Pricing engine                            | ✅ Done     |
| 5     | Deal engine & workflow                    | ✅ Done     |
| 6     | Retailer adapters & ingestion             | ✅ Done     |
| 7     | Background jobs & deal detection          | ✅ Done     |
| 8     | Authentication & roles                    | ✅ Done     |
| 9+    | See roadmap in `docs/ARCHITECTURE.md` §13 | Not started |
