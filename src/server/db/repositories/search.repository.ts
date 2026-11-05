import { Prisma } from "@/generated/prisma/client";
import { allowsTypoMatching, queryTerms, type SearchSort } from "@/lib/validation/search";
import type { DbClient } from "../types";
import { publicDealInclude, type PublicDealRow } from "./public.repository";

// Deal search: PostgreSQL full-text search over the product (title, brand, model,
// description — see product_search_document in the search migration) plus trigram word
// similarity on the title, so small typos still match. Only public deals are searched:
// PUBLISHED, on an active listing, at an ACTIVE retailer.

/** How close a keyword must be to a word in the title to count as a typo match (0–1). */
export const TYPO_SIMILARITY = 0.5;

export type DealSearch = {
  q: string;
  categoryIds?: string[];
  retailerId?: string;
  minPrice?: number;
  maxPrice?: number;
  minDiscountBps?: number;
  inStock?: boolean;
  sort: SearchSort;
  skip: number;
  take: number;
};

/** The full-text document of product `p` (see product_search_document in the search migration). */
export const PRODUCT_DOCUMENT = Prisma.sql`product_search_document(p."title", p."brand", p."model", p."description")`;

/**
 * Plain queries: every word must match, either as a word in the product's text or — to
 * forgive typos — as something close to a word in the title. Stop words ("the") are skipped,
 * but at least one real word is needed, so "the" or "%_" match nothing rather than everything.
 * Queries with operators ("phrases", -exclusions, OR) use exact full-text semantics.
 */
function keywordCondition(q: string): Prisma.Sql {
  if (!allowsTypoMatching(q)) {
    return Prisma.sql`${PRODUCT_DOCUMENT} @@ websearch_to_tsquery('english', ${q})`;
  }
  const hasRealWord = Prisma.sql`(
    numnode(plainto_tsquery('english', ${q})) > 0
    OR word_similarity(lower(${q}), lower(p."title")) >= ${TYPO_SIMILARITY}
  )`;
  const eachWord = queryTerms(q).map(
    (term) => Prisma.sql`(
      numnode(plainto_tsquery('english', ${term})) = 0
      OR ${PRODUCT_DOCUMENT} @@ plainto_tsquery('english', ${term})
      OR word_similarity(${term}, lower(p."title")) >= ${TYPO_SIMILARITY}
    )`,
  );
  return Prisma.join([hasRealWord, ...eachWord], " AND ");
}

function conditions(search: DealSearch): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`d."status" = 'PUBLISHED'`,
    Prisma.sql`p."isActive"`,
    Prisma.sql`r."status" = 'ACTIVE'`,
  ];
  if (search.q) parts.push(keywordCondition(search.q));
  if (search.categoryIds) parts.push(Prisma.sql`p."categoryId" = ANY(${search.categoryIds})`);
  if (search.retailerId) parts.push(Prisma.sql`d."retailerId" = ${search.retailerId}`);
  if (search.minPrice !== undefined) parts.push(Prisma.sql`d."dealPrice" >= ${search.minPrice}`);
  if (search.maxPrice !== undefined) parts.push(Prisma.sql`d."dealPrice" <= ${search.maxPrice}`);
  if (search.minDiscountBps !== undefined) {
    parts.push(Prisma.sql`d."discountBps" >= ${search.minDiscountBps}`);
  }
  if (search.inStock) parts.push(Prisma.sql`p."availability" IN ('IN_STOCK', 'LOW_STOCK')`);
  return Prisma.join(parts, " AND ");
}

function orderBy(search: DealSearch): Prisma.Sql {
  switch (search.sort) {
    case "relevance":
      return search.q
        ? Prisma.sql`ts_rank_cd(${PRODUCT_DOCUMENT}, websearch_to_tsquery('english', ${search.q}))
            + word_similarity(lower(${search.q}), lower(p."title")) DESC,
          d."score" DESC, d."publishedAt" DESC`
        : Prisma.sql`d."publishedAt" DESC`;
    case "newest":
      return Prisma.sql`d."publishedAt" DESC`;
    case "discount":
      return Prisma.sql`d."discountBps" DESC, d."publishedAt" DESC`;
    case "saving":
      return Prisma.sql`d."savingAmount" DESC, d."publishedAt" DESC`;
    case "price-asc":
      return Prisma.sql`d."dealPrice" ASC, d."publishedAt" DESC`;
    case "price-desc":
      return Prisma.sql`d."dealPrice" DESC, d."publishedAt" DESC`;
  }
}

const FROM = Prisma.sql`
  FROM "Deal" d
  JOIN "Product" p ON p."id" = d."productId"
  JOIN "Retailer" r ON r."id" = d."retailerId"`;

export function createSearchRepository(client: DbClient) {
  return {
    /** One page of matching public deals, in the requested order, and the total count. */
    async searchDeals(search: DealSearch): Promise<{ items: PublicDealRow[]; total: number }> {
      const where = conditions(search);
      const [ids, counted] = await Promise.all([
        client.$queryRaw<{ id: string }[]>`
          SELECT d."id" ${FROM}
          WHERE ${where}
          ORDER BY ${orderBy(search)}, d."id" DESC
          LIMIT ${search.take} OFFSET ${search.skip}`,
        client.$queryRaw<{ total: number }[]>`
          SELECT count(*)::int AS "total" ${FROM} WHERE ${where}`,
      ]);
      const rows = ids.length
        ? await client.deal.findMany({
            where: { id: { in: ids.map((r) => r.id) } },
            include: publicDealInclude,
          })
        : [];
      const byId = new Map(rows.map((row) => [row.id, row]));
      return {
        // Keep the SQL order; a deal deleted between the two queries is simply skipped.
        items: ids.map((r) => byId.get(r.id)).filter((row) => row !== undefined),
        total: counted[0]?.total ?? 0,
      };
    },
  };
}

export type SearchRepository = ReturnType<typeof createSearchRepository>;
