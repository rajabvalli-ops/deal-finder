import type { DbClient } from "../types";

export type ProductLink = {
  id: string;
  code: string;
  destinationUrl: string;
  network: string | null;
  isActive: boolean;
};

const productLinkSelect = {
  id: true,
  code: true,
  destinationUrl: true,
  network: true,
  isActive: true,
} as const;

export type ClickInput = {
  affiliateLinkId: string;
  dealId: string | null;
  productId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  referrer: string | null;
  placement: string | null;
  isBot: boolean;
  createdAt: Date;
};

export function createAffiliateRepository(client: DbClient) {
  return {
    /** The product-level link (not tied to a deal), active or not. */
    findProductLink(productId: string): Promise<ProductLink | null> {
      return client.affiliateLink.findFirst({
        where: { productId, dealId: null },
        select: productLinkSelect,
      });
    },

    /**
     * Inserts a product-level link unless one already exists for the product or the code
     * is taken (ON CONFLICT DO NOTHING, so a transaction is never aborted). Returns whether
     * a row was inserted.
     */
    async insertProductLink(data: {
      code: string;
      retailerId: string;
      productId: string;
      destinationUrl: string;
      network: string;
    }): Promise<boolean> {
      const { count } = await client.affiliateLink.createMany({
        data: [{ ...data, isActive: true }],
        skipDuplicates: true,
      });
      return count === 1;
    },

    updateLink(
      id: string,
      data: { destinationUrl: string; network: string; isActive: boolean },
    ): Promise<ProductLink> {
      return client.affiliateLink.update({ where: { id }, data, select: productLinkSelect });
    },

    /** Everything the redirect needs to decide whether a code may be followed. */
    findByCode(code: string) {
      return client.affiliateLink.findUnique({
        where: { code },
        select: {
          id: true,
          code: true,
          destinationUrl: true,
          isActive: true,
          productId: true,
          dealId: true,
          retailer: {
            select: { id: true, status: true, adapterKey: true, adapterConfig: true },
          },
          product: { select: { isActive: true } },
        },
      });
    },

    /** Active product-level link codes, keyed by product ID. */
    async activeProductLinkCodes(productIds: readonly string[]): Promise<Map<string, string>> {
      if (productIds.length === 0) return new Map();
      const rows = await client.affiliateLink.findMany({
        where: { productId: { in: [...productIds] }, dealId: null, isActive: true },
        select: { productId: true, code: true },
      });
      return new Map(rows.map((r) => [r.productId!, r.code]));
    },

    /** A deal's ID when its slug belongs to the given product; used to attribute clicks. */
    async dealIdForProduct(slug: string, productId: string): Promise<string | null> {
      const deal = await client.deal.findUnique({
        where: { slug },
        select: { id: true, productId: true },
      });
      return deal && deal.productId === productId ? deal.id : null;
    },

    async recordClick(data: ClickInput): Promise<void> {
      await client.click.create({ data });
    },
  };
}

export type AffiliateRepository = ReturnType<typeof createAffiliateRepository>;
